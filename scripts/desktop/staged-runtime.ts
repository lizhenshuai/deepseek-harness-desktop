/** Deterministic package closure, projection, and content inventory for desktop staging. */

import { createHash } from 'node:crypto'
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { PackedTarball } from '../release/packed-consumer.ts'

/** One checksum-pinned Node distribution accepted by desktop staging. */
export interface RuntimeTarget {
  readonly id: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly nodeVersion: string
  readonly archiveUrl: string
  readonly archiveSha256: string
  readonly archiveRoot: string
}

/** One installed package directory reachable from the dsh executable package. */
export interface RuntimePackage {
  readonly path: string
  readonly directory: string
  readonly name: string
  readonly version: string
  readonly manifest: Readonly<Record<string, unknown>>
}

/** One locked package location in the projected npm tree. */
interface RuntimeLockPackage {
  readonly path: string
  readonly name: string
  readonly version: string
  readonly source: 'packed' | 'registry'
  readonly integrity?: string
  readonly sha256?: string
}

/** Reproducible npm layout required by the desktop runtime. */
export interface RuntimeLock {
  readonly schemaVersion: 1
  readonly target: string
  readonly npmVersion: string
  readonly packages: readonly RuntimeLockPackage[]
}

/** One file sealed by the runtime content manifest. */
export interface RuntimeFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

/** Machine-independent inventory consumed by the desktop shell and installer. */
export interface RuntimeManifest {
  readonly schemaVersion: 1
  readonly target: {
    readonly platform: NodeJS.Platform
    readonly arch: string
    readonly nodeVersion: string
    readonly dshVersion: string
  }
  readonly entrypoint: {
    readonly executable: 'node/node.exe'
    readonly script: 'app/node_modules/@deepseek-ai/dsh/lib/bin.js'
    readonly profile: 'web'
  }
  readonly inputs: {
    readonly packedWebProofSha256: string
    readonly nodeArchiveSha256: string
    readonly runtimeLockSha256: string
    readonly tarballs: readonly { name: string; version: string; sha256: string }[]
  }
  readonly packages: readonly RuntimeLockPackage[]
  readonly executables: readonly string[]
  readonly files: readonly RuntimeFile[]
}

const TEST_SEGMENTS = new Set(['__tests__', 'coverage', 'fixture', 'fixtures', 'test', 'tests'])
const SOURCE_EXTENSIONS = new Set(['.bat', '.c', '.cc', '.cmd', '.cpp', '.gyp', '.gypi', '.h', '.map', '.md', '.ps1', '.ts', '.tsx', '.tsbuildinfo'])
const EXECUTABLE_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.dll', '.exe', '.node', '.ps1'])
const SECRET_NAMES = /^(?:\.env(?:\..*)?|id_rsa|.*\.(?:key|p12|pfx|pem))$/i
const PRIVATE_KEY_CONTENT = new RegExp(
  '-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----\\r?\\n' +
  '(?:[A-Za-z0-9+/=]{16,}\\r?\\n){2,}' +
  '-----END (?:[A-Z]+ )*PRIVATE KEY-----',
)
const NPM_AUTH_CONTENT = /(?:^|\n)\s*\/\/(?:registry\.)?[^\n]*:_authToken\s*=/i

/** Return a lowercase SHA-256 digest for a file. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Parse a JSON object and retain its path in malformed-input diagnostics. */
export function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${path} is not a JSON object`)
  return parsed as Record<string, unknown>
}

/** Resolve the production package graph from one installed package. */
export function resolveProductionClosure(consumerRoot: string, rootPackageName: string): RuntimePackage[] {
  const root = resolve(consumerRoot)
  const start = resolveInstalledPackage(root, root, rootPackageName)
  if (start === undefined) throw new Error(`CLOSURE_UNRESOLVED: installed root package ${rootPackageName} is absent`)
  const found = new Map<string, RuntimePackage>()
  const visit = (directory: string): void => {
    const real = realpathSync(directory)
    if (found.has(real)) return
    assertContained(root, real, `package ${directory}`)
    const manifest = readJsonObject(join(real, 'package.json'))
    const name = manifest.name
    const version = manifest.version
    if (typeof name !== 'string' || typeof version !== 'string') throw new Error(`CLOSURE_UNRESOLVED: ${real} lacks package name/version`)
    const packagePath = normalizePath(relative(root, real))
    found.set(real, { path: packagePath, directory: real, name, version, manifest })

    const required = dependencyNames(manifest.dependencies)
    const optional = new Set(dependencyNames(manifest.optionalDependencies))
    const peerOptional = optionalPeerNames(manifest.peerDependenciesMeta)
    for (const dependency of [...new Set([
      ...required,
      ...optional,
      ...dependencyNames(manifest.peerDependencies),
    ])].sort()) {
      const target = resolveInstalledPackage(root, real, dependency)
      if (target === undefined) {
        if (optional.has(dependency) || peerOptional.has(dependency)) continue
        throw new Error(`CLOSURE_UNRESOLVED: ${name} cannot resolve required package ${dependency}`)
      }
      visit(target)
    }
  }
  visit(start)
  return [...found.values()].sort((left, right) => left.path.localeCompare(right.path))
}

/** Build the lock record for one resolved npm layout. */
export function buildRuntimeLock(
  target: string,
  npmVersion: string,
  consumerRoot: string,
  packages: readonly RuntimePackage[],
  tarballs: readonly PackedTarball[],
): RuntimeLock {
  const hiddenLockPath = join(consumerRoot, 'node_modules', '.package-lock.json')
  const hiddenLock = readJsonObject(hiddenLockPath)
  const lockPackages = hiddenLock.packages
  if (lockPackages === null || typeof lockPackages !== 'object' || Array.isArray(lockPackages)) {
    throw new Error(`${hiddenLockPath} lacks packages`)
  }
  const packedByName = new Map(tarballs.map(tarball => [tarball.name, tarball]))
  const entries = packages.map((runtimePackage): RuntimeLockPackage => {
    const packed = packedByName.get(runtimePackage.name)
    if (packed !== undefined) {
      return {
        path: runtimePackage.path,
        name: runtimePackage.name,
        version: runtimePackage.version,
        source: 'packed',
        sha256: packed.sha256,
      }
    }
    const lockEntry = (lockPackages as Record<string, unknown>)[runtimePackage.path]
    if (lockEntry === null || typeof lockEntry !== 'object' || Array.isArray(lockEntry)) {
      throw new Error(`LOCK_DRIFT: npm lock has no entry for ${runtimePackage.path}`)
    }
    const integrity = (lockEntry as Record<string, unknown>).integrity
    if (typeof integrity !== 'string' || integrity === '') {
      throw new Error(`LOCK_DRIFT: registry package ${runtimePackage.path} has no integrity`)
    }
    return {
      path: runtimePackage.path,
      name: runtimePackage.name,
      version: runtimePackage.version,
      source: 'registry',
      integrity,
    }
  })
  return { schemaVersion: 1, target, npmVersion, packages: entries }
}

/** Copy the package graph into a runtime tree without development-only payloads. */
export function projectRuntimePackages(
  packages: readonly RuntimePackage[],
  consumerRoot: string,
  appRoot: string,
): void {
  for (const runtimePackage of packages) {
    const destination = join(appRoot, runtimePackage.path)
    copyPackageFiles(runtimePackage.directory, destination, consumerRoot, runtimePackage.name)
  }
}

/** Reject links, credentials, build residue, and checkout paths in a projected runtime. */
export function verifyRuntimePolicy(runtimeRoot: string, forbiddenRoots: readonly string[]): void {
  for (const path of walkFiles(runtimeRoot, true)) {
    const relativePath = normalizePath(relative(runtimeRoot, path))
    const basename = relativePath.split('/').at(-1) ?? ''
    if (SECRET_NAMES.test(basename)) throw new Error(`FORBIDDEN_FILE: ${relativePath} has a credential-bearing name`)
    const stat = statSync(path)
    if (stat.size > 4 * 1024 * 1024) continue
    const contents = readFileSync(path)
    if (contents.includes(0)) continue
    const text = contents.toString('utf8')
    if (PRIVATE_KEY_CONTENT.test(text) || NPM_AUTH_CONTENT.test(text)) {
      throw new Error(`FORBIDDEN_FILE: ${relativePath} contains credential material`)
    }
    for (const root of forbiddenRoots) {
      const absoluteRoot = resolve(root)
      const variants = [absoluteRoot, absoluteRoot.replaceAll('\\', '/'), absoluteRoot.replaceAll('\\', '\\\\')]
      if (variants.some(variant => variant !== '' && text.toLowerCase().includes(variant.toLowerCase()))) {
        throw new Error(`REPOSITORY_PATH_FOUND: ${relativePath} contains ${root}`)
      }
    }
  }
}

/** Build the sorted file and executable inventories for a runtime directory. */
export function inventoryRuntime(runtimeRoot: string): { files: RuntimeFile[]; executables: string[] } {
  const files = walkFiles(runtimeRoot, true)
    .map(path => normalizePath(relative(runtimeRoot, path)))
    .filter(path => path !== 'runtime-manifest.json')
    .sort()
    .map((path): RuntimeFile => {
      const absolute = join(runtimeRoot, path)
      return { path, bytes: statSync(absolute).size, sha256: sha256File(absolute) }
    })
  const executables = files.map(file => file.path).filter(path => EXECUTABLE_EXTENSIONS.has(extname(path).toLowerCase()))
  return { files, executables }
}

/** Write stable JSON with one trailing newline. */
export function writeStableJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

const PUBLISH_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 4_000, 8_000, 16_000] as const
const TRANSIENT_RENAME_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM'])

/** Test substitutions for the Windows staged-directory publish boundary. */
export interface StagedPublishInternals {
  readonly rename?: (source: string, destination: string) => Promise<void>
  readonly delay?: (milliseconds: number) => Promise<void>
}

/**
 * Move a fully validated sibling directory into its final absent destination.
 * @param source - Validated temporary directory beside the destination.
 * @param destination - Final path that must remain absent until publication.
 * @param internals - Test substitutions for rename and delay.
 * @returns When the atomic directory rename has completed.
 */
export async function publishStagedDirectory(
  source: string,
  destination: string,
  internals: StagedPublishInternals = {},
): Promise<void> {
  if (existsSync(destination)) throw new Error(`staging output already exists: ${destination}`)
  mkdirSync(dirname(destination), { recursive: true })
  const renameDirectory = internals.rename ?? rename
  const delay = internals.delay ?? wait
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameDirectory(source, destination)
      return
    } catch (error) {
      const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
      const retryDelay = PUBLISH_RETRY_DELAYS_MS[attempt]
      if (typeof code !== 'string' || !TRANSIENT_RENAME_CODES.has(code) || retryDelay === undefined) throw error
      if (existsSync(destination)) throw new Error(`staging output already exists: ${destination}`, { cause: error })
      await delay(retryDelay)
    }
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolveWait => setTimeout(resolveWait, milliseconds))
}

/** Remove a known temporary tree without following links or junctions. */
export function removeTreeSafe(path: string): void {
  if (!existsSync(path)) return
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    unlinkSync(path)
    return
  }
  for (const entry of readdirSync(path)) removeTreeSafe(join(path, entry))
  rmdirSync(path)
}

function dependencyNames(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value).sort()
}

function optionalPeerNames(value: unknown): Set<string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return new Set()
  return new Set(Object.entries(value).flatMap(([name, metadata]) => {
    if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      && (metadata as Record<string, unknown>).optional === true) return [name]
    return []
  }))
}

function resolveInstalledPackage(consumerRoot: string, from: string, name: string): string | undefined {
  let cursor = resolve(from)
  const root = resolve(consumerRoot)
  while (cursor === root || cursor.startsWith(root + sep)) {
    const candidate = join(cursor, 'node_modules', ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (cursor === root) break
    cursor = dirname(cursor)
  }
  return undefined
}

function copyPackageFiles(
  source: string,
  destination: string,
  consumerRoot: string,
  packageName: string,
  prefix = '',
): void {
  for (const entry of readdirSync(source, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'node_modules') continue
    const sourcePath = join(source, entry.name)
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (excludedPackagePath(relativePath, entry.isDirectory(), packageName)) continue
    const stat = lstatSync(sourcePath)
    if (stat.isSymbolicLink()) throw new Error(`LINK_ESCAPE: package payload ${sourcePath} is a link`)
    const destinationPath = join(destination, entry.name)
    if (stat.isDirectory()) {
      copyPackageFiles(sourcePath, destinationPath, consumerRoot, packageName, relativePath)
    } else if (stat.isFile()) {
      assertContained(consumerRoot, realpathSync(sourcePath), `package file ${sourcePath}`)
      mkdirSync(dirname(destinationPath), { recursive: true })
      copyFileSync(sourcePath, destinationPath)
    }
  }
}

function excludedPackagePath(path: string, directory: boolean, packageName: string): boolean {
  const parts = path.split('/')
  if (parts.some(part => TEST_SEGMENTS.has(part.toLowerCase()))) return true
  const prebuilds = parts.indexOf('prebuilds')
  if (prebuilds >= 0 && parts[prebuilds + 1] !== undefined && parts[prebuilds + 1] !== 'win32-x64') return true
  if (packageName === 'node-pty' && ['deps', 'scripts', 'src', 'third_party', 'typings'].includes(parts[0] ?? '')) return true
  if (directory) return parts.at(-1)?.toLowerCase() === '.github'
  const basename = parts.at(-1) ?? ''
  const lower = basename.toLowerCase()
  if (['.gitignore', '.npmignore'].includes(lower)) return true
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/i.test(lower)) return true
  if (/^(?:licen[cs]e|notice|copying)(?:\..*)?$/i.test(basename)) return false
  return SOURCE_EXTENSIONS.has(extname(lower))
}

function walkFiles(root: string, rejectLinks: boolean): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        if (rejectLinks) throw new Error(`LINK_ESCAPE: ${path} is a link or junction`)
        continue
      }
      if (stat.isDirectory()) visit(path)
      else if (stat.isFile()) files.push(path)
    }
  }
  visit(root)
  return files
}

function assertContained(root: string, target: string, subject: string): void {
  const fromRoot = relative(resolve(root), resolve(target))
  if (fromRoot === '' || (!isAbsolute(fromRoot) && !fromRoot.startsWith(`..${sep}`) && fromRoot !== '..')) return
  throw new Error(`LINK_ESCAPE: ${subject} resolves outside ${root}`)
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

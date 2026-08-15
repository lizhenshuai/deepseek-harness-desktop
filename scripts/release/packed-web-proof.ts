/**
 * Release-shaped Web runtime proof: start an installed dsh with plain Node,
 * wait for the settled Loader signal, fetch the Vite shell and every advertised
 * Client bundle, and reject profile links that escape the installed consumer.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Stable proof-report format consumed by the later desktop staging work. */
const PACKED_WEB_PROOF_SCHEMA_VERSION = 2

const READY_PATTERN = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/
const BOOT_PATTERN = /<script>window\.__DSH_BOOT__ = (.*?)<\/script>/s
const LOCAL_ASSET_PATTERN = /<(?:script|link)\b[^>]*(?:src|href)="(\/[^"#]+)"/g
const OUTPUT_LIMIT = 32 * 1024
const DEFAULT_START_TIMEOUT_MS = 60_000
const FETCH_TIMEOUT_MS = 10_000
const STOP_TIMEOUT_MS = 10_000
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD)/i

/** One validated Client row from the host-injected boot graph. */
export interface PackedClientModule {
  readonly id: string
  readonly url: string
  readonly rev: string
  readonly inject: readonly string[]
  readonly immediately: boolean
}

/** One fetched browser resource recorded without an installation path. */
interface PackedWebResource {
  readonly url: string
  readonly bytes: number
  readonly sha256: string
}

/** Packed package identity supplied to the throwaway consumer. */
interface PackedPackageIdentity {
  readonly name: string
  readonly version: string
  readonly sha256: string
}

/** Machine-independent evidence emitted after the packed Web runtime passes. */
export interface PackedWebProofReport {
  readonly schemaVersion: 2
  readonly target: {
    readonly platform: NodeJS.Platform
    readonly arch: string
    readonly nodeVersion: string
    readonly dshVersion: string
  }
  readonly profile: {
    readonly name: 'web'
    readonly bundles: readonly ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  }
  readonly packages: readonly PackedPackageIdentity[]
  readonly clientModules: readonly PackedClientModule[]
  readonly frontendAssets: readonly PackedWebResource[]
  readonly checks: {
    readonly outsideRepository: true
    readonly profileLinksContained: true
    readonly webReady: true
    readonly allClientBundlesReachable: true
    readonly credentialsAbsent: true
  }
}

/** Inputs for the release-shaped Web proof. */
export interface ProvePackedWebOptions {
  readonly node: string
  readonly bin: string
  readonly consumerRoot: string
  readonly repositoryRoot: string
  readonly environment: NodeJS.ProcessEnv
  readonly dshVersion: string
  readonly packages: readonly PackedPackageIdentity[]
  readonly reportPath?: string
  readonly startTimeoutMs?: number
}

interface NodeTarget {
  readonly version: string
  readonly platform: NodeJS.Platform
  readonly arch: string
}

/** Error carrying a stable failure class for CI and desktop release diagnostics. */
class PackedWebProofError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options)
    this.name = 'PackedWebProofError'
  }
}

/**
 * Remove credentials and host Node hooks before the installed Web process can
 * expose its environment through diagnostics or a spawned tool.
 * @param source - Ambient environment inherited by the release verifier.
 * @returns A copy safe for the keyless runtime proof.
 */
export function scrubRuntimeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(source)) {
    if (SECRET_NAME.test(name)) continue
    environment[name] = value
  }
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  delete environment.npm_config_user_agent
  delete environment.NPM_CONFIG_USER_AGENT
  return environment
}

/**
 * Validate the repository engine range used by the desktop runtime proposal.
 * @param raw - `node --version` output.
 * @returns The normalized version without the leading `v`.
 */
export function supportedNodeVersion(raw: string): string {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim())
  if (match === null) throw new PackedWebProofError('NODE_UNSUPPORTED', `cannot parse Node version ${JSON.stringify(raw.trim())}`)
  const major = Number.parseInt(match[1] ?? '', 10)
  const minor = Number.parseInt(match[2] ?? '', 10)
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    throw new PackedWebProofError('NODE_UNSUPPORTED', `Node ${match[0]} does not satisfy ^22.19 || >=24`)
  }
  return `${String(major)}.${String(minor)}.${match[3] ?? ''}`
}

/**
 * Parse and validate the host-injected Client graph.
 * @param html - Served application index.
 * @returns Stable Client rows sorted by package id.
 */
export function parsePackedBootManifest(html: string): PackedClientModule[] {
  const match = BOOT_PATTERN.exec(html)
  if (match?.[1] === undefined) {
    throw new PackedWebProofError('BOOT_MANIFEST_MISSING', 'served index has no window.__DSH_BOOT__ assignment')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch (error) {
    throw new PackedWebProofError('CLIENT_GRAPH_INVALID', 'window.__DSH_BOOT__ is not valid JSON', { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { rev?: unknown }).rev !== 'string'
    || !Array.isArray((parsed as { entries?: unknown }).entries)) {
    throw new PackedWebProofError('CLIENT_GRAPH_INVALID', 'boot graph must carry string rev and entries array')
  }
  const rows: PackedClientModule[] = []
  const ids = new Set<string>()
  for (const value of (parsed as { entries: unknown[] }).entries) {
    if (typeof value !== 'object' || value === null) {
      throw new PackedWebProofError('CLIENT_GRAPH_INVALID', 'boot graph entry is not an object')
    }
    const row = value as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.url !== 'string' || typeof row.rev !== 'string') {
      throw new PackedWebProofError('CLIENT_GRAPH_INVALID', 'boot graph entry must carry string id, url, and rev')
    }
    if (ids.has(row.id)) throw new PackedWebProofError('CLIENT_GRAPH_INVALID', `duplicate Client package ${JSON.stringify(row.id)}`)
    if (row.url !== `/plugins/${row.id}/client.js?rev=${row.rev}`) {
      throw new PackedWebProofError('CLIENT_GRAPH_INVALID', `Client package ${JSON.stringify(row.id)} advertises invalid URL ${JSON.stringify(row.url)}`)
    }
    if (row.inject !== undefined && (!Array.isArray(row.inject) || row.inject.some(item => typeof item !== 'string'))) {
      throw new PackedWebProofError('CLIENT_GRAPH_INVALID', `Client package ${JSON.stringify(row.id)} has invalid inject list`)
    }
    if (row.immediately !== undefined && typeof row.immediately !== 'boolean') {
      throw new PackedWebProofError('CLIENT_GRAPH_INVALID', `Client package ${JSON.stringify(row.id)} has invalid immediately flag`)
    }
    ids.add(row.id)
    rows.push({
      id: row.id,
      url: row.url,
      rev: row.rev,
      inject: row.inject === undefined ? [] : [...row.inject as string[]].sort(),
      immediately: row.immediately === true,
    })
  }
  if (rows.length === 0) throw new PackedWebProofError('CLIENT_GRAPH_INVALID', 'boot graph advertises no Client packages')
  return rows.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * Extract local Vite and public assets from the served index.
 * @param html - Served application index.
 * @returns Unique root-relative URLs in lexical order.
 */
export function localAssetsFromIndex(html: string): string[] {
  return [...html.matchAll(LOCAL_ASSET_PATTERN)]
    .flatMap(match => match[1] === undefined ? [] : [match[1]])
    .filter(url => !url.startsWith('//'))
    .filter((url, index, all) => all.indexOf(url) === index)
    .sort()
}

/**
 * Reject a proof directory nested in the repository.
 * @param repositoryRoot - Source checkout root.
 * @param consumerRoot - Throwaway installed consumer.
 */
export function assertOutsideRepository(repositoryRoot: string, consumerRoot: string): void {
  const fromRepository = relative(resolve(repositoryRoot), resolve(consumerRoot))
  if (fromRepository === '' || (!isAbsolute(fromRepository) && !fromRepository.startsWith(`..${sep}`) && fromRepository !== '..')) {
    throw new PackedWebProofError('WORKSPACE_LINK_FOUND', `packed consumer is inside the repository: ${fromRepository || '.'}`)
  }
}

/**
 * Ensure every profile fallback link resolves into the installed consumer.
 * @param consumerRoot - Throwaway installed consumer and allowed target root.
 * @param profilesModules - `$DSH_HOME/profiles/node_modules` created by dsh.
 */
function assertProfileLinksContained(consumerRoot: string, profilesModules: string): void {
  const allowed = realpathSync(consumerRoot)
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path)
        assertContainedTarget(allowed, target, `profile module ${relative(profilesModules, path)}`)
      } else if (stat.isDirectory()) {
        visit(path)
      }
    }
  }
  visit(profilesModules)
}

/**
 * Reject a resolved dynamic-package target outside its installed consumer.
 * @param consumerRoot - Allowed installed root.
 * @param target - Resolved package target.
 * @param subject - Relative diagnostic label.
 */
export function assertContainedTarget(consumerRoot: string, target: string, subject: string): void {
  const allowed = resolve(consumerRoot)
  const resolvedTarget = resolve(target)
  if (resolvedTarget !== allowed && !resolvedTarget.startsWith(allowed + sep)) {
    throw new PackedWebProofError('WORKSPACE_LINK_FOUND', `${subject} resolves outside the packed consumer`)
  }
}

/** Run the installed Web profile and emit its machine-independent proof. */
export async function provePackedWeb(options: ProvePackedWebOptions): Promise<PackedWebProofReport> {
  assertOutsideRepository(options.repositoryRoot, options.consumerRoot)
  const nodeTarget = await readNodeTarget(options.node, options.environment)
  const runtimeEnvironment = scrubRuntimeEnvironment(options.environment)
  const child = spawn(options.node, [options.bin, 'web', '--host', '127.0.0.1', '--port', '0'], {
    cwd: options.consumerRoot,
    env: runtimeEnvironment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const appendOutput = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT)
  }
  child.stdout.on('data', appendOutput)
  child.stderr.on('data', appendOutput)

  try {
    const baseUrl = await waitForReady(child, () => output, options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS)
    const index = await fetchText(baseUrl + '/', 'frontend index')
    const clientModules = parsePackedBootManifest(index.body)
    const resourceUrls = [
      ...localAssetsFromIndex(index.body),
      ...clientModules.map(row => row.url),
    ].filter((url, index, all) => all.indexOf(url) === index).sort()
    const frontendAssets: PackedWebResource[] = []
    for (const url of resourceUrls) {
      const resource = await fetchBytes(baseUrl + url, url)
      frontendAssets.push({
        url,
        bytes: resource.byteLength,
        sha256: createHash('sha256').update(resource).digest('hex'),
      })
    }
    const runtimeHome = options.environment.DSH_HOME
    if (runtimeHome === undefined || runtimeHome === '') {
      throw new PackedWebProofError('PROFILE_BUNDLE_UNRESOLVED', 'runtime proof environment has no DSH_HOME')
    }
    const profilesModules = join(resolve(runtimeHome), 'profiles', 'node_modules')
    assertProfileLinksContained(options.consumerRoot, profilesModules)
    const report: PackedWebProofReport = {
      schemaVersion: PACKED_WEB_PROOF_SCHEMA_VERSION,
      target: {
        platform: nodeTarget.platform,
        arch: nodeTarget.arch,
        nodeVersion: nodeTarget.version,
        dshVersion: options.dshVersion,
      },
      profile: {
        name: 'web',
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      },
      packages: [...options.packages].sort((left, right) => left.name.localeCompare(right.name)),
      clientModules,
      frontendAssets,
      checks: {
        outsideRepository: true,
        profileLinksContained: true,
        webReady: true,
        allClientBundlesReachable: true,
        credentialsAbsent: true,
      },
    }
    if (options.reportPath !== undefined) {
      mkdirSync(dirname(options.reportPath), { recursive: true })
      writeFileSync(options.reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
    }
    return report
  } finally {
    await stopChild(child)
  }
}

async function readNodeTarget(node: string, environment: NodeJS.ProcessEnv): Promise<NodeTarget> {
  const expression = 'process.stdout.write(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch}))'
  const child = spawn(node, ['--eval', expression], {
    env: scrubRuntimeEnvironment(environment),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  let status: { code: number | null; signal: NodeJS.Signals | null }
  try {
    status = await childExit(child)
  } catch (error) {
    throw new PackedWebProofError('NODE_UNSUPPORTED', `cannot start Node executable ${JSON.stringify(node)}`, { cause: error })
  }
  if (status.code !== 0) throw new PackedWebProofError('NODE_UNSUPPORTED', `${node} target probe failed: ${stderr.trim()}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new PackedWebProofError('NODE_UNSUPPORTED', `${node} target probe returned invalid JSON`, { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null
    || typeof (parsed as { version?: unknown }).version !== 'string'
    || typeof (parsed as { platform?: unknown }).platform !== 'string'
    || typeof (parsed as { arch?: unknown }).arch !== 'string') {
    throw new PackedWebProofError('NODE_UNSUPPORTED', `${node} target probe returned invalid fields`)
  }
  const target = parsed as { version: string; platform: NodeJS.Platform; arch: string }
  return { version: supportedNodeVersion(target.version), platform: target.platform, arch: target.arch }
}

async function waitForReady(child: ChildProcess, output: () => string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolveReady, rejectReady) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', inspect)
      child.stderr?.off('data', inspect)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const inspect = (): void => {
      const match = READY_PATTERN.exec(output())
      if (match?.[1] === undefined) return
      cleanup()
      resolveReady(match[1])
    }
    const onError = (error: Error): void => {
      cleanup()
      rejectReady(new PackedWebProofError('WEB_EXITED_EARLY', 'failed to spawn dsh web', { cause: error }))
    }
    const onExit = (code: number | null): void => {
      cleanup()
      rejectReady(new PackedWebProofError('WEB_EXITED_EARLY', `dsh web exited with ${String(code)} before readiness:\n${output()}`))
    }
    const timer = setTimeout(() => {
      cleanup()
      rejectReady(new PackedWebProofError('WEB_START_TIMEOUT', `dsh web did not become ready within ${String(timeoutMs)}ms:\n${output()}`))
    }, timeoutMs)
    timer.unref()
    child.stdout?.on('data', inspect)
    child.stderr?.on('data', inspect)
    child.once('error', onError)
    child.once('exit', onExit)
    inspect()
  })
}

async function fetchText(url: string, subject: string): Promise<{ body: string }> {
  const response = await fetchWithProofError(url, subject)
  const body = await response.text()
  if (body.length === 0) throw new PackedWebProofError('CLIENT_BUNDLE_UNREACHABLE', `${subject} returned an empty body`)
  return { body }
}

async function fetchBytes(url: string, subject: string): Promise<Buffer> {
  const response = await fetchWithProofError(url, subject)
  const body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength === 0) throw new PackedWebProofError('CLIENT_BUNDLE_UNREACHABLE', `${subject} returned an empty body`)
  return body
}

async function fetchWithProofError(url: string, subject: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (error) {
    throw new PackedWebProofError('CLIENT_BUNDLE_UNREACHABLE', `${subject} request failed`, { cause: error })
  }
  if (!response.ok) {
    throw new PackedWebProofError('CLIENT_BUNDLE_UNREACHABLE', `${subject} returned HTTP ${String(response.status)}`)
  }
  return response
}

function childExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code, signal) => { resolveExit({ code, signal }) })
  })
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = childExit(child)
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolveTimeout) => {
      const timer = setTimeout(() => { resolveTimeout(false) }, STOP_TIMEOUT_MS)
      timer.unref()
    }),
  ])
  if (stopped) return
  child.kill('SIGKILL')
  await exited
}

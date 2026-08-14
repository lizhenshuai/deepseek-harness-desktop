/** Shared installation primitives for release tarballs and desktop staging. */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, posix, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { capture } from './process.ts'
import { packedIdentity } from './tarball.ts'

/** One formal npm tarball supplied to a packed consumer. */
export interface PackedTarball {
  readonly name: string
  readonly version: string
  readonly path: string
  readonly url: string
  readonly sha256: string
}

/**
 * Build an isolated environment for npm installation and runtime verification.
 * @param consumerRoot - Temporary consumer directory.
 * @returns Environment with private npm and dsh data directories.
 */
export function packedConsumerEnvironment(consumerRoot: string): NodeJS.ProcessEnv {
  const discarded = new Set([
    'node_options',
    'node_path',
    'npm_config_cache',
    'npm_config_manage_package_manager_versions',
    'npm_config_user_agent',
  ])
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !discarded.has(name.toLowerCase())),
  )
  environment.npm_config_cache = resolve(consumerRoot, '.npm-cache')
  environment.DSH_HOME = resolve(consumerRoot, '.dsh')
  environment.DSH_AGENTS_HOME = resolve(consumerRoot, '.agents')
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

/**
 * Read, identify, and hash every tarball in the supplied directories.
 * @param directories - Absolute tarball directories.
 * @returns Tarballs sorted by package name.
 */
export function readPackedTarballs(directories: readonly string[]): PackedTarball[] {
  const packages = new Map<string, PackedTarball>()
  for (const directory of directories) {
    const filenames = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
    if (filenames.length === 0) throw new Error(`${directory} holds no packed tarball`)
    for (const filename of filenames) {
      const path = join(directory, filename)
      const { name, version } = packedIdentity(path)
      if (packages.has(name)) throw new Error(`packed package ${name} appears more than once`)
      packages.set(name, {
        name,
        version,
        path,
        url: pathToFileURL(path).href,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      })
    }
  }
  return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Locate the npm CLI shipped beside an explicit Node executable.
 * @param node - Node executable from an official distribution.
 * @param platform - Node distribution platform; injectable for tests.
 * @returns npm's JavaScript entry path.
 */
export function npmCliForNode(node: string, platform: NodeJS.Platform = process.platform): string {
  const paths = platform === 'win32' ? win32 : posix
  const root = paths.dirname(node)
  return platform === 'win32'
    ? paths.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : paths.join(root, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
}

/**
 * Install every supplied tarball as a top-level dependency.
 * @param node - Node executable that owns the npm CLI and native ABI.
 * @param consumerRoot - Directory containing the generated package manifest.
 * @param environment - Isolated installation environment.
 */
export function installPackedTarballs(
  node: string,
  consumerRoot: string,
  environment: NodeJS.ProcessEnv,
): void {
  const args = [npmCliForNode(node), 'install', '--no-audit', '--no-fund', '--package-lock=false']
  capture(node, args, { cwd: consumerRoot, env: environment })
}

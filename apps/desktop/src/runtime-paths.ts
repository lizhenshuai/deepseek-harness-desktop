import { lstatSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/** Inputs whose explicit source distinguishes packaged layout from a test artifact. */
export interface RuntimePathOptions {
  /** Whether Electron is running a packaged application. */
  readonly isPackaged: boolean
  /** Electron resources directory used only by packaged applications. */
  readonly resourcesPath: string
  /** Explicit Task 2 runtime root used only by development and tests. */
  readonly stagedRuntimeRoot?: string
}

/**
 * Resolve and validate the immutable Task 2 runtime directory.
 * @param options - Packaged or explicit test layout facts.
 * @returns Absolute runtime root containing the manifest, Node, and dsh entry.
 * @throws Error for an override in packaged mode, an implicit development path, or a missing runtime file.
 */
export function resolveDesktopRuntimeRoot(options: RuntimePathOptions): string {
  if (options.isPackaged && options.stagedRuntimeRoot !== undefined) {
    throw new Error('desktop: a packaged application cannot override its staged runtime root')
  }
  const candidate = options.isPackaged
    ? join(options.resourcesPath, 'runtime')
    : options.stagedRuntimeRoot
  if (candidate === undefined || !isAbsolute(candidate)) {
    throw new Error('desktop: development requires an explicit absolute staged runtime root')
  }
  const root = resolve(candidate)
  for (const relative of ['runtime-manifest.json', 'node/node.exe', 'app/package.json']) {
    const path = join(root, ...relative.split('/'))
    let stat
    try {
      stat = lstatSync(path)
    } catch {
      throw new Error(`desktop: staged runtime is missing ${relative}`)
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`desktop: staged runtime ${relative} must be a regular file`)
    }
  }
  return root
}

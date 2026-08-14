/** Context-free managed process-tree entry for trusted host supervisors. */

import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { spawnSubprocess } from './spawn.ts'
import type { LocalSubprocessHandle } from './spawn.ts'

/** Host-only spawn choices outside the cross-provider subprocess request. */
export interface ManagedProcessOptions {
  /** Hide the child console window on Windows. */
  readonly windowsHide?: boolean
}

/** A managed tree with the synchronous host-exit fallback retained locally. */
export type ManagedProcessHandle = LocalSubprocessHandle

/**
 * Spawn one managed process tree without constructing the Cordis service provider.
 * @param spec - Fully resolved command, environment, streams, grace, and cancellation.
 * @param options - Host-only presentation choices.
 * @returns A handle whose normal and synchronous termination cover the owned tree.
 */
export function spawnManagedProcess(
  spec: SubprocessSpawnSpec,
  options: ManagedProcessOptions = {},
): ManagedProcessHandle {
  return spawnSubprocess(spec, options.windowsHide === undefined ? {} : { windowsHide: options.windowsHide })
}

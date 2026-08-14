/** Generation-fenced lifecycle for the packaged loopback Web backend. */

import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  spawnManagedProcess, type ManagedProcessHandle,
} from '@deepseek-ai/dsh-subprocess-local/src/managed-process.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { DesktopDiagnostics } from './diagnostics.ts'
import { parseManagedBackendOrigin } from './origin-policy.ts'

const READY_PATTERN = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)$/m
const START_TIMEOUT_MS = 60_000
const STOP_TIMEOUT_MS = 5_000

/** Observable desktop-owned backend lifecycle state. */
export type BackendState =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'starting'; readonly generation: number }
  | { readonly kind: 'ready'; readonly generation: number; readonly origin: string }
  | { readonly kind: 'stopping'; readonly generation: number }
  | { readonly kind: 'failed'; readonly generation: number; readonly message: string }

/** Spawn adapter used by production and deterministic controller tests. */
type ManagedProcessSpawner = (spec: SubprocessSpawnSpec) => ManagedProcessHandle

/** Controller construction facts. */
export interface BackendControllerOptions {
  readonly runtimeRoot: string
  readonly userData: string
  readonly environment?: Readonly<NodeJS.ProcessEnv>
  readonly spawn?: ManagedProcessSpawner
  readonly probe?: (url: string, signal: AbortSignal) => Promise<boolean>
  readonly startTimeoutMs?: number
  readonly stopTimeoutMs?: number
}

/** Own the sole local backend process and serialize every lifecycle transition. */
export class DesktopBackendController {
  readonly diagnostics: DesktopDiagnostics
  private currentState: BackendState = { kind: 'stopped' }
  private generation = 0
  private process: ManagedProcessHandle | undefined
  private disposeOutput: (() => void) | undefined
  private queue: Promise<void> = Promise.resolve()
  private startupAbort: AbortController | undefined
  private readonly listeners = new Set<(state: BackendState) => void>()

  constructor(private readonly options: BackendControllerOptions) {
    this.diagnostics = new DesktopDiagnostics(options.userData)
  }

  /** Current immutable lifecycle fact. */
  state(): BackendState {
    return this.currentState
  }

  /** Observe transitions and return the exact listener disposer. */
  onState(listener: (state: BackendState) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Start once and return the probed loopback origin. Concurrent calls serialize. */
  start(): Promise<string> {
    return this.enqueue(async () => this.startInternal())
  }

  /** Cancel startup if needed, then gracefully stop with tree termination fallback. */
  stop(): Promise<void> {
    this.startupAbort?.abort('desktop stop requested')
    return this.enqueue(async () => { await this.stopInternal() })
  }

  /** Replace the current generation and return the new probed endpoint. */
  restart(): Promise<string> {
    this.startupAbort?.abort('desktop restart requested')
    return this.enqueue(async () => {
      await this.stopInternal()
      return this.startInternal()
    })
  }

  /** Synchronous final process-tree fallback for Windows session termination. */
  terminateForHostExit(): void {
    this.process?.terminateForHostExit()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async startInternal(): Promise<string> {
    if (this.currentState.kind === 'ready') return this.currentState.origin
    const generation = ++this.generation
    const abort = new AbortController()
    this.startupAbort = abort
    this.diagnostics.beginGeneration()
    this.transition({ kind: 'starting', generation })
    const home = join(this.options.userData, 'harness')
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const node = join(this.options.runtimeRoot, 'node', 'node.exe')
    const entry = join(this.options.runtimeRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const spec: SubprocessSpawnSpec = {
      argv: [node, entry, 'web', '--supervised-stdin', '--host', '127.0.0.1', '--port', '0'],
      cwd: home,
      env: { ...this.options.environment, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS,
    }
    const handle = (this.options.spawn ?? (value => spawnManagedProcess(value, { windowsHide: true })))(spec)
    this.process = handle
    const output = { value: '' }
    const disposeOutput = this.captureOutput(handle, output)
    this.disposeOutput = disposeOutput
    void handle.done.then(
      (outcome) => { this.observeUnexpectedExit(generation, outcome) },
      (error: unknown) => { this.observeUnexpectedFailure(generation, error) },
    )
    try {
      const origin = await this.waitUntilReady(handle, output, abort.signal)
      if (generation !== this.generation || abort.signal.aborted) throw new Error('desktop: backend startup cancelled')
      this.transition({ kind: 'ready', generation, origin })
      return origin
    } catch (error) {
      handle.terminate()
      disposeOutput()
      if (this.disposeOutput === disposeOutput) this.disposeOutput = undefined
      await this.waitBounded(handle, this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS)
      if (this.process === handle) this.process = undefined
      const message = error instanceof Error ? error.message : String(error)
      if (generation === this.generation) {
        this.transition(abort.signal.aborted ? { kind: 'stopped' } : { kind: 'failed', generation, message })
      }
      throw error
    } finally {
      if (this.startupAbort === abort) this.startupAbort = undefined
    }
  }

  private async stopInternal(): Promise<void> {
    const handle = this.process
    if (handle === undefined) {
      if (this.currentState.kind !== 'failed') this.transition({ kind: 'stopped' })
      return
    }
    const generation = this.generation
    this.transition({ kind: 'stopping', generation })
    this.disposeOutput?.()
    this.disposeOutput = undefined
    handle.stdin?.on('error', () => { /* Child exit owns the outcome when the shutdown write races it. */ })
    handle.stdin?.end('shutdown\n')
    if (!await this.waitBounded(handle, this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS)) {
      handle.terminate()
      if (!await this.waitBounded(handle, this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS)) {
        handle.terminateForHostExit()
        throw new Error('desktop: backend process tree did not stop')
      }
    }
    if (this.process === handle) this.process = undefined
    this.transition({ kind: 'stopped' })
  }

  private captureOutput(handle: SubprocessHandle, output: { value: string }): () => void {
    const attach = (stream: Readable | undefined, source: 'stderr' | 'stdout'): (() => void) => {
      if (stream === undefined) return () => undefined
      const onData = (chunk: Buffer | string): void => {
        const text = chunk.toString()
        if (source === 'stdout') output.value = `${output.value}${text}`.slice(-64 * 1024)
        for (const line of text.split(/\r?\n/u)) if (line !== '') this.diagnostics.append(source, line)
      }
      stream.on('data', onData)
      return () => { stream.off('data', onData) }
    }
    const stdout = attach(handle.stdout, 'stdout')
    const stderr = attach(handle.stderr, 'stderr')
    return () => { stdout(); stderr() }
  }

  private async waitUntilReady(
    handle: SubprocessHandle,
    output: { value: string },
    parentSignal: AbortSignal,
  ): Promise<string> {
    const timeout = AbortSignal.timeout(this.options.startTimeoutMs ?? START_TIMEOUT_MS)
    const signal = AbortSignal.any([timeout, parentSignal])
    while (!signal.aborted) {
      const match = READY_PATTERN.exec(output.value)
      if (match?.[1] !== undefined) {
        const origin = parseManagedBackendOrigin(match[1]).origin
        if (await (this.options.probe ?? probeBackend)(origin, signal)) return origin
      }
      const outcome = await Promise.race([
        handle.done.then(value => ({ kind: 'exit' as const, value })),
        delay(25, signal).then(() => ({ kind: 'tick' as const })),
      ])
      if (outcome.kind === 'exit') {
        throw new Error(`desktop: backend exited before readiness (${describeOutcome(outcome.value)})`)
      }
    }
    throw new Error(parentSignal.aborted ? 'desktop: backend startup cancelled' : 'desktop: backend readiness timed out')
  }

  private async waitBounded(handle: SubprocessHandle, timeoutMs: number): Promise<boolean> {
    return handle.waitForExit(AbortSignal.timeout(timeoutMs))
  }

  private observeUnexpectedExit(generation: number, outcome: SubprocessOutcome): void {
    if (generation !== this.generation || this.currentState.kind === 'stopping') return
    if (this.currentState.kind !== 'ready') return
    this.process = undefined
    this.disposeOutput?.()
    this.disposeOutput = undefined
    this.transition({
      kind: 'failed',
      generation,
      message: `desktop: backend exited unexpectedly (${describeOutcome(outcome)})`,
    })
  }

  private observeUnexpectedFailure(generation: number, error: unknown): void {
    if (generation !== this.generation || this.currentState.kind === 'stopping') return
    this.process = undefined
    this.disposeOutput?.()
    this.disposeOutput = undefined
    this.transition({
      kind: 'failed',
      generation,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  private transition(state: BackendState): void {
    this.currentState = state
    this.diagnostics.append('desktop', state.kind)
    for (const listener of this.listeners) {
      try { listener(state) } catch { /* An observer cannot break process ownership. */ }
    }
  }
}

async function probeBackend(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${url}/`, { redirect: 'manual', signal })
    return response.status === 200
  } catch (error) {
    if (signal.aborted) throw error
    return false
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

function describeOutcome(outcome: SubprocessOutcome): string {
  return outcome.signal === null ? `exit ${String(outcome.exitCode)}` : `signal ${outcome.signal}`
}

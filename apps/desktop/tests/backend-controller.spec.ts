import type { SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { ManagedProcessHandle } from '@deepseek-ai/dsh-subprocess-local/managed-process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopBackendController } from '../src/backend-controller.ts'

const scratch: string[] = []
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function temporaryRuntime(): { root: string; userData: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-controller-'))
  scratch.push(root)
  const userData = join(root, 'user-data')
  mkdirSync(userData)
  return { root, userData }
}

function fakeHandle(): ManagedProcessHandle & {
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  readonly terminateSpy: ReturnType<typeof vi.fn>
  exit(outcome?: SubprocessOutcome): void
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  let resolveDone: (outcome: SubprocessOutcome) => void = () => undefined
  const done = new Promise<SubprocessOutcome>((resolve) => { resolveDone = resolve })
  const terminateSpy = vi.fn(() => { exit({ exitCode: null, signal: 'SIGTERM' }) })
  let exited = false
  const exit = (outcome: SubprocessOutcome = { exitCode: 0, signal: null }): void => {
    if (exited) return
    exited = true
    resolveDone(outcome)
  }
  stdin.on('data', (chunk: Buffer) => { if (chunk.toString() === 'shutdown\n') exit() })
  return {
    pid: 42,
    stdin,
    stdout,
    stderr,
    collected: {},
    done,
    terminate: terminateSpy,
    terminateSpy,
    terminateForHostExit: vi.fn(() => { exit({ exitCode: null, signal: 'SIGKILL' }) }),
    waitForExit: vi.fn(async (signal?: AbortSignal) => {
      if (exited) return true
      return Promise.race([
        done.then(() => true),
        new Promise<boolean>((resolve) => {
          signal?.addEventListener('abort', () => { resolve(false) }, { once: true })
        }),
      ])
    }),
    exit,
  }
}

describe('desktop backend controller', () => {
  it('spawns the staged CLI, probes readiness, and stops through stdin', async () => {
    vi.stubEnv('DESKTOP_SAFE_MARKER', 'available')
    vi.stubEnv('DESKTOP_SECRET_TOKEN', 'hidden')
    vi.stubEnv('DSH_INHERITED_MARKER', 'hidden')
    const paths = temporaryRuntime()
    const child = fakeHandle()
    const specs: SubprocessSpawnSpec[] = []
    const controller = new DesktopBackendController({
      runtimeRoot: paths.root,
      userData: paths.userData,
      spawn: (spec) => {
        specs.push(spec)
        setTimeout(() => { child.stdout.write('dsh web: http://127.0.0.1:43121\n') }, 0)
        return child
      },
      probe: async () => true,
      startTimeoutMs: 500,
      stopTimeoutMs: 100,
    })

    await expect(controller.start()).resolves.toBe('http://127.0.0.1:43121')
    expect(controller.state().kind).toBe('ready')
    expect(specs[0]?.argv.slice(-6)).toEqual([
      'web', '--supervised-stdin', '--host', '127.0.0.1', '--port', '0',
    ])
    expect(specs[0]?.env?.DSH_HOME).toBe(join(paths.userData, 'harness'))
    expect(specs[0]?.env?.DESKTOP_SAFE_MARKER).toBe('available')
    expect(specs[0]?.env?.DESKTOP_SECRET_TOKEN).toBeUndefined()
    expect(specs[0]?.env?.DSH_INHERITED_MARKER).toBeUndefined()
    await controller.stop()
    expect(controller.state()).toEqual({ kind: 'stopped' })
    expect(child.terminateSpy).not.toHaveBeenCalled()
  })

  it('reports an unexpected exit only for the active ready generation', async () => {
    const paths = temporaryRuntime()
    const child = fakeHandle()
    const controller = new DesktopBackendController({
      runtimeRoot: paths.root,
      userData: paths.userData,
      spawn: () => {
        setTimeout(() => { child.stdout.write('dsh web: http://127.0.0.1:43122\n') }, 0)
        return child
      },
      probe: async () => true,
      startTimeoutMs: 500,
    })
    await controller.start()
    child.exit({ exitCode: 7, signal: null })
    await vi.waitFor(() => { expect(controller.state().kind).toBe('failed') })
    const state = controller.state()
    expect(state.kind).toBe('failed')
    if (state.kind !== 'failed') throw new Error('expected failed backend state')
    expect(state.message).toContain('exit 7')
  })

  it('escalates a backend that ignores the graceful stdin request', async () => {
    const paths = temporaryRuntime()
    const child = fakeHandle()
    const controller = new DesktopBackendController({
      runtimeRoot: paths.root,
      userData: paths.userData,
      spawn: () => {
        setTimeout(() => { child.stdout.write('dsh web: http://127.0.0.1:43123\n') }, 0)
        return child
      },
      probe: async () => true,
      startTimeoutMs: 500,
      stopTimeoutMs: 10,
    })
    await controller.start()
    child.stdin?.removeAllListeners('data')
    await controller.stop()
    expect(child.terminateSpy).toHaveBeenCalledOnce()
    expect(controller.state()).toEqual({ kind: 'stopped' })
  })

  it('bounds startup and terminates a backend that never becomes ready', async () => {
    const paths = temporaryRuntime()
    const child = fakeHandle()
    const controller = new DesktopBackendController({
      runtimeRoot: paths.root,
      userData: paths.userData,
      spawn: () => child,
      probe: async () => false,
      startTimeoutMs: 20,
      stopTimeoutMs: 20,
    })
    await expect(controller.start()).rejects.toThrow('readiness timed out')
    expect(child.terminateSpy).toHaveBeenCalledOnce()
    expect(controller.state().kind).toBe('failed')
  })
})

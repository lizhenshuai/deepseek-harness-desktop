import { describe, expect, it, vi } from 'vitest'
import { runDesktopShell } from '../src/shell.ts'
import type { ActivatableWindow, DesktopApp } from '../src/types.ts'

function fakeWindow(minimized = false): ActivatableWindow & { focus: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> } {
  return {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore: vi.fn(),
    focus: vi.fn(),
  }
}

function fakeApp(primary: boolean): DesktopApp & {
  callbacks: Map<string, () => void>
  enableSandbox: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
} {
  const callbacks = new Map<string, () => void>()
  return {
    isPackaged: false,
    callbacks,
    enableSandbox: vi.fn(),
    requestSingleInstanceLock: () => primary,
    quit: vi.fn(),
    whenReady: async () => {},
    on: (event, listener) => { callbacks.set(event, listener) },
  }
}

describe('desktop shell composition', () => {
  it('quits a secondary process before resolving its endpoint', async () => {
    const app = fakeApp(false)
    const endpoint = vi.fn(async () => 'http://127.0.0.1:43121')
    const createWindow = vi.fn(async () => fakeWindow())
    await expect(runDesktopShell({ app, endpoint, createWindow })).resolves.toEqual({ kind: 'secondary' })
    expect(app.enableSandbox).toHaveBeenCalledOnce()
    expect(app.quit).toHaveBeenCalledOnce()
    expect(endpoint).not.toHaveBeenCalled()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('creates one primary window and restores it for a second instance', async () => {
    const app = fakeApp(true)
    const window = fakeWindow(true)
    const result = await runDesktopShell({
      app,
      endpoint: async () => 'http://127.0.0.1:43121',
      createWindow: async () => window,
    })
    expect(result.kind).toBe('primary')
    app.callbacks.get('second-instance')?.()
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('replays activation requested before the window exists', async () => {
    const app = fakeApp(true)
    const window = fakeWindow()
    let releaseReady!: () => void
    app.whenReady = () => new Promise<void>((resolve) => { releaseReady = resolve })
    const running = runDesktopShell({
      app,
      endpoint: async () => 'http://127.0.0.1:43121',
      createWindow: async () => window,
    })
    app.callbacks.get('activate')?.()
    releaseReady()
    await running
    expect(window.focus).toHaveBeenCalledOnce()
  })
})

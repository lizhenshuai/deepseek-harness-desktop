import { EventEmitter } from 'node:events'
import type { App, BrowserWindow, Dialog, MenuItemConstructorOptions, Shell } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { installApplicationLifecycle } from '../src/application-lifecycle.ts'
import type { BackendState, DesktopBackendController } from '../src/backend-controller.ts'

describe('desktop application lifecycle', () => {
  it('blocks the first quit until the backend stops and then permits app.quit', async () => {
    const app = new EventEmitter() as EventEmitter & Pick<App, 'off' | 'on' | 'quit'>
    app.quit = vi.fn()
    const window = new EventEmitter() as EventEmitter & Pick<BrowserWindow, 'hide' | 'off' | 'on'>
    window.hide = vi.fn()
    const stop = vi.fn(async () => undefined)
    let stateListener: ((state: BackendState) => void) | undefined
    const controller = {
      diagnostics: { currentPath: 'C:\\logs\\backend.log', tail: () => '' },
      stop,
      restart: vi.fn(async () => 'http://127.0.0.1:43121'),
      terminateForHostExit: vi.fn(),
      onState: vi.fn((listener: (state: BackendState) => void) => {
        stateListener = listener
        return vi.fn()
      }),
    } as unknown as DesktopBackendController
    let menu: MenuItemConstructorOptions[] = []
    installApplicationLifecycle({
      app: app as App,
      controller,
      dialog: { showMessageBox: vi.fn() } as unknown as Dialog,
      shell: { showItemInFolder: vi.fn() } as unknown as Shell,
      setMenu: (value) => { menu = value },
      currentWindow: () => window as BrowserWindow,
      replaceWindow: vi.fn(async () => undefined),
    })
    const event = { preventDefault: vi.fn() }
    app.emit('before-quit', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(app.quit).toHaveBeenCalledOnce() })
    expect(stop).toHaveBeenCalledOnce()
    expect(menu[0]?.submenu).toBeDefined()
    expect(stateListener).toBeTypeOf('function')
  })

  it('uses synchronous tree termination when Windows ends the session', () => {
    const app = new EventEmitter() as EventEmitter & Pick<App, 'off' | 'on' | 'quit'>
    app.quit = vi.fn()
    const window = new EventEmitter() as EventEmitter & Pick<BrowserWindow, 'hide' | 'off' | 'on'>
    window.hide = vi.fn()
    const terminateForHostExit = vi.fn()
    const controller = {
      diagnostics: { currentPath: 'C:\\logs\\backend.log', tail: () => '' },
      stop: vi.fn(async () => undefined),
      restart: vi.fn(async () => 'http://127.0.0.1:43121'),
      terminateForHostExit,
      onState: vi.fn(() => vi.fn()),
    } as unknown as DesktopBackendController
    installApplicationLifecycle({
      app: app as App,
      controller,
      dialog: { showMessageBox: vi.fn() } as unknown as Dialog,
      shell: { showItemInFolder: vi.fn() } as unknown as Shell,
      setMenu: vi.fn(),
      currentWindow: () => window as BrowserWindow,
      replaceWindow: vi.fn(async () => undefined),
    })
    window.emit('session-end')
    expect(terminateForHostExit).toHaveBeenCalledOnce()
  })
})

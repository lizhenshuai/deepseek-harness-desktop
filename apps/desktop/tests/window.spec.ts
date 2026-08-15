import type { Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { parseManagedBackendOrigin } from '../src/origin-policy.ts'
import {
  installPermissionPolicy, installWebContentsPolicy, secureWindowOptions,
} from '../src/window.ts'

describe('desktop window policy', () => {
  it('uses a sandboxed renderer with no Node, preload, or WebView', () => {
    expect(secureWindowOptions(true)).toMatchObject({
      show: false,
      webPreferences: {
        contextIsolation: true,
        devTools: false,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    })
    expect(secureWindowOptions(false).webPreferences?.devTools).toBe(true)
    expect(secureWindowOptions(true).webPreferences?.preload).toBeUndefined()
  })

  it('denies permission checks and requests', () => {
    let check!: () => boolean
    let request!: (_contents: WebContents, _permission: string, callback: (allowed: boolean) => void) => void
    const target = {
      setPermissionCheckHandler: (handler: typeof check) => { check = handler },
      setPermissionRequestHandler: (handler: typeof request) => { request = handler },
    } as unknown as Session
    installPermissionPolicy(target)
    expect(check()).toBe(false)
    const callback = vi.fn()
    request({} as WebContents, 'notifications', callback)
    expect(callback).toHaveBeenCalledWith(false)
  })

  it('blocks unmanaged navigation and delegates only validated external links', async () => {
    const listeners = new Map<string, (...args: never[]) => void>()
    let windowOpen!: (details: { url: string }) => { action: string }
    const contents = {
      on: (event: string, listener: (...args: never[]) => void) => { listeners.set(event, listener) },
      setWindowOpenHandler: (handler: typeof windowOpen) => { windowOpen = handler },
    } as unknown as WebContents
    const openExternal = vi.fn(async () => {})
    const report = vi.fn()
    const managed = parseManagedBackendOrigin('http://127.0.0.1:43121')
    installWebContentsPolicy(contents, managed, openExternal, report)

    const allowedEvent = { preventDefault: vi.fn() }
    listeners.get('will-frame-navigate')?.({ ...allowedEvent, url: `${managed.origin}/settings` } as never)
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled()
    const deniedEvent = { preventDefault: vi.fn() }
    listeners.get('will-redirect')?.({ ...deniedEvent, url: 'https://example.com/' } as never)
    expect(deniedEvent.preventDefault).toHaveBeenCalledOnce()
    const webviewEvent = { preventDefault: vi.fn() }
    listeners.get('will-attach-webview')?.(webviewEvent as never)
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce()

    expect(windowOpen({ url: 'https://example.com/docs' })).toEqual({ action: 'deny' })
    await Promise.resolve()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(windowOpen({ url: `${managed.origin}/inside` })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
  })

  it('reports both rejected and synchronous external-open failures', async () => {
    let windowOpen!: (details: { url: string }) => { action: string }
    const contents = {
      on: () => contents,
      setWindowOpenHandler: (handler: typeof windowOpen) => { windowOpen = handler },
    } as unknown as WebContents
    const report = vi.fn()
    installWebContentsPolicy(
      contents,
      parseManagedBackendOrigin('http://127.0.0.1:43121'),
      async () => { throw new Error('async failure') },
      report,
    )
    windowOpen({ url: 'https://example.com/' })
    await Promise.resolve()
    await Promise.resolve()
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'async failure' }))

    installWebContentsPolicy(
      contents,
      parseManagedBackendOrigin('http://127.0.0.1:43121'),
      () => { throw new Error('sync failure') },
      report,
    )
    windowOpen({ url: 'https://example.com/' })
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'sync failure' }))
  })
})

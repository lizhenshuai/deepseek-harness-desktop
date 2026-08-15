import type {
  BrowserWindow as ElectronBrowserWindow, BrowserWindowConstructorOptions, Rectangle,
  Session, WebContents,
} from 'electron'
import { externalBrowserUrl, isManagedNavigation } from './origin-policy.ts'
import type { ManagedBackendOrigin } from './types.ts'

/** Electron adapters used to create the desktop window. */
export interface WindowDependencies {
  /** Native window constructor. */
  readonly BrowserWindow: typeof ElectronBrowserWindow
  /** Default renderer session whose permission policy is replaced. */
  readonly session: Session
  /** Validated external URL delegate. */
  readonly openExternal: (url: string) => Promise<void>
  /** Sink for a rejected external-open promise. */
  readonly reportExternalError: (error: unknown) => void
  /** Whether developer tools must be disabled. */
  readonly isPackaged: boolean
  /** Restored bounds after display validation. */
  readonly initialBounds?: Rectangle
  /** Persist the last normal bounds before destruction. */
  readonly persistBounds?: (bounds: Rectangle) => void
}

/**
 * Return the security-sensitive options for the sole renderer.
 * @param isPackaged - Disables developer tools in packaged applications.
 * @returns BrowserWindow options with no Node or preload access.
 */
export function secureWindowOptions(
  isPackaged: boolean,
  initialBounds?: Rectangle,
): BrowserWindowConstructorOptions {
  return {
    width: initialBounds?.width ?? 1280,
    height: initialBounds?.height ?? 800,
    ...initialBounds === undefined ? {} : { x: initialBounds.x, y: initialBounds.y },
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      devTools: !isPackaged,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  }
}

/**
 * Deny every renderer permission in the Web application session.
 * @param target - Electron session used by the desktop window.
 */
export function installPermissionPolicy(target: Session): void {
  target.setPermissionCheckHandler(() => false)
  target.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
}

/**
 * Restrict frames, redirects, child windows, and external delegation.
 * @param contents - WebContents belonging to the sole desktop window.
 * @param managed - Exact loopback origin allocated to the backend.
 * @param openExternal - System-browser delegate called only with a validated URL.
 * @param reportExternalError - Sink for asynchronous or synchronous delegate failures.
 */
export function installWebContentsPolicy(
  contents: WebContents,
  managed: ManagedBackendOrigin,
  openExternal: (url: string) => Promise<void>,
  reportExternalError: (error: unknown) => void,
): void {
  const guard = (details: { url: string; preventDefault(): void }): void => {
    if (!isManagedNavigation(details.url, managed)) details.preventDefault()
  }
  contents.on('will-frame-navigate', guard)
  contents.on('will-redirect', guard)
  contents.on('will-attach-webview', (event) => { event.preventDefault() })
  contents.setWindowOpenHandler(({ url }) => {
    const external = externalBrowserUrl(url, managed)
    if (external !== undefined) {
      try {
        void openExternal(external).catch(reportExternalError)
      } catch (error) {
        reportExternalError(error)
      }
    }
    return { action: 'deny' }
  })
}

/**
 * Create and load the one sandboxed desktop window.
 * @param dependencies - Electron adapters and diagnostics.
 * @param managed - Validated backend origin.
 * @returns Loaded native window, initially shown by `ready-to-show`.
 */
export async function createDesktopWindow(
  dependencies: WindowDependencies,
  managed: ManagedBackendOrigin,
): Promise<ElectronBrowserWindow> {
  installPermissionPolicy(dependencies.session)
  const window = new dependencies.BrowserWindow(secureWindowOptions(
    dependencies.isPackaged,
    dependencies.initialBounds,
  ))
  installWebContentsPolicy(window.webContents, managed, dependencies.openExternal, dependencies.reportExternalError)
  if (dependencies.persistBounds !== undefined) {
    window.on('close', () => {
      if (!window.isMinimized() && !window.isMaximized() && !window.isFullScreen()) {
        dependencies.persistBounds?.(window.getBounds())
      }
    })
  }
  window.once('ready-to-show', () => { window.show() })
  await window.loadURL(managed.href)
  return window
}

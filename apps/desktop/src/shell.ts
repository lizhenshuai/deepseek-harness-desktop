import { parseManagedBackendOrigin } from './origin-policy.ts'
import type {
  ActivatableWindow, DesktopApp, DesktopBackendEndpointProvider, ManagedBackendOrigin,
} from './types.ts'

/** Dependencies that compose Electron application events with the window owner. */
export interface DesktopShellDependencies {
  /** Narrow Electron application adapter. */
  readonly app: DesktopApp
  /** Endpoint produced after an externally owned backend becomes ready. */
  readonly endpoint: DesktopBackendEndpointProvider
  /** Create the sole window for a validated endpoint. */
  readonly createWindow: (origin: ManagedBackendOrigin) => Promise<ActivatableWindow>
}

/** Result distinguishes a primary shell from a secondary process that exited. */
export type DesktopShellResult =
  | { readonly kind: 'primary'; readonly origin: ManagedBackendOrigin; readonly window: ActivatableWindow }
  | { readonly kind: 'secondary' }

/**
 * Compose sandbox enablement, single-instance activation, readiness, and the sole window.
 * @param dependencies - Electron application, backend endpoint, and window factory.
 * @returns Primary window state, or secondary after requesting immediate quit.
 */
export async function runDesktopShell(dependencies: DesktopShellDependencies): Promise<DesktopShellResult> {
  const { app } = dependencies
  app.enableSandbox()
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return { kind: 'secondary' }
  }

  const state: { window?: ActivatableWindow; activationPending: boolean } = { activationPending: false }
  const activate = (): void => {
    if (state.window === undefined || state.window.isDestroyed()) {
      state.activationPending = true
      return
    }
    if (state.window.isMinimized()) state.window.restore()
    state.window.focus()
  }
  app.on('second-instance', activate)
  app.on('activate', activate)

  await app.whenReady()
  const origin = parseManagedBackendOrigin(await dependencies.endpoint())
  state.window = await dependencies.createWindow(origin)
  if (state.activationPending) activate()
  return { kind: 'primary', origin, window: state.window }
}

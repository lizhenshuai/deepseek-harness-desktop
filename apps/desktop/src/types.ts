/** A validated loopback endpoint returned after the staged Web backend is ready. */
export interface ManagedBackendOrigin {
  /** Canonical browser origin used for all navigation comparisons. */
  readonly origin: string
  /** Root URL loaded into the Electron window. */
  readonly href: string
}

/** Resolve the one backend endpoint consumed by the desktop shell. */
export type DesktopBackendEndpointProvider = () => Promise<string>

/** Minimal application methods the shell needs from Electron. */
export interface DesktopApp {
  /** Whether this executable came from a packaged Electron application. */
  readonly isPackaged: boolean
  /** Enable Chromium sandboxing before Electron becomes ready. */
  enableSandbox(): void
  /** Acquire Electron's process-wide application lock. */
  requestSingleInstanceLock(): boolean
  /** Terminate this Electron process. */
  quit(): void
  /** Resolve after Electron initialization. */
  whenReady(): Promise<void>
  /** Register activation callbacks; argument data is intentionally ignored. */
  on(event: 'activate' | 'second-instance', listener: () => void): unknown
}

/** Window operations used by single-instance activation. */
export interface ActivatableWindow {
  /** Whether the native window has been destroyed. */
  isDestroyed(): boolean
  /** Whether the native window is minimized. */
  isMinimized(): boolean
  /** Restore a minimized native window. */
  restore(): void
  /** Focus the native window. */
  focus(): void
}

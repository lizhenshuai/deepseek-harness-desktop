/** Electron quit, recovery, and native menu coordination for the backend owner. */

import type {
  App, BrowserWindow, Dialog, MenuItemConstructorOptions, MessageBoxOptions, Shell,
} from 'electron'
import type { DesktopBackendController } from './backend-controller.ts'
import type { ManagedBackendOrigin } from './types.ts'

/** Native adapters and mutable window ownership needed by lifecycle actions. */
export interface ApplicationLifecycleOptions {
  readonly app: App
  readonly controller: DesktopBackendController
  readonly dialog: Dialog
  readonly shell: Shell
  readonly setMenu: (template: MenuItemConstructorOptions[]) => void
  readonly currentWindow: () => BrowserWindow | undefined
  readonly replaceWindow: (origin: ManagedBackendOrigin) => Promise<void>
}

/** Install bounded app exit, Windows session-end fallback, recovery, and application menu. */
export function installApplicationLifecycle(options: ApplicationLifecycleOptions): () => void {
  let quitAllowed = false
  let quitPending = false
  let recoveryPending = false
  const quit = (): void => {
    if (quitPending) return
    quitPending = true
    void options.controller.stop().catch((error: unknown) => {
      console.error('desktop: graceful backend stop failed', error)
      options.controller.terminateForHostExit()
    }).finally(() => {
      quitAllowed = true
      options.app.quit()
    })
  }
  const delayQuit = (event: Electron.Event): void => {
    if (quitAllowed) return
    event.preventDefault()
    quit()
  }
  options.app.on('before-quit', delayQuit)
  const window = options.currentWindow()
  const sessionEnd = (): void => { options.controller.terminateForHostExit() }
  window?.on('query-session-end', delayQuit)
  window?.on('session-end', sessionEnd)

  const openLogs = (): void => { options.shell.showItemInFolder(options.controller.diagnostics.currentPath) }
  const restart = async (): Promise<void> => {
    const origin = await options.controller.restart()
    await options.replaceWindow({ origin, href: `${origin}/` })
  }
  const recover = async (initialError: unknown): Promise<void> => {
    if (recoveryPending || quitPending) return
    recoveryPending = true
    let error = initialError
    try {
      while (!quitPending) {
        const dialogOptions: MessageBoxOptions = {
          type: 'error',
          title: 'DeepSeek Harness 后端已停止',
          message: error instanceof Error ? error.message : String(error),
          detail: options.controller.diagnostics.tail(),
          buttons: ['重试', '打开日志', '退出'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        }
        const parent = options.currentWindow()
        const result = parent === undefined
          ? await options.dialog.showMessageBox(dialogOptions)
          : await options.dialog.showMessageBox(parent, dialogOptions)
        if (result.response === 1) {
          openLogs()
          continue
        }
        if (result.response === 2) {
          quit()
          return
        }
        try {
          await restart()
          return
        } catch (restartError) {
          error = restartError
        }
      }
    } finally {
      recoveryPending = false
    }
  }
  const disposeState = options.controller.onState((state) => {
    if (state.kind === 'failed') {
      options.currentWindow()?.hide()
      void recover(new Error(state.message))
    }
  })
  options.setMenu([
    {
      label: '应用',
      submenu: [
        { label: '重启后端', click: () => { void restart().catch(recover) } },
        { label: '打开日志', click: openLogs },
        { type: 'separator' },
        { label: '退出', click: quit },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
  ])
  return () => {
    disposeState()
    options.app.off('before-quit', delayQuit)
    window?.off('query-session-end', delayQuit)
    window?.off('session-end', sessionEnd)
  }
}

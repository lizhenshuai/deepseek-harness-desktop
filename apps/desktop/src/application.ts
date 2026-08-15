/** Product startup for the Electron main process. */

import {
  app, BrowserWindow, dialog, Menu, screen, session, shell,
} from 'electron'
import { isAbsolute, resolve } from 'node:path'
import { installApplicationLifecycle } from './application-lifecycle.ts'
import { DesktopBackendController } from './backend-controller.ts'
import { resolveDesktopRuntimeRoot } from './runtime-paths.ts'
import { runDesktopShell } from './shell.ts'
import type { ManagedBackendOrigin } from './types.ts'
import { createDesktopWindow } from './window.ts'
import { loadWindowBounds, saveWindowBounds } from './window-state.ts'

export function startDesktopApplication(): void {
  app.setAppUserModelId('com.deepseek.DeepSeekHarness')
  const testUserData = process.env.DSH_DESKTOP_TEST_USER_DATA
  if (!app.isPackaged && testUserData !== undefined) {
    if (!isAbsolute(testUserData)) throw new Error('desktop: DSH_DESKTOP_TEST_USER_DATA must be absolute')
    app.setPath('userData', resolve(testUserData))
  }

  const runtimeRoot = resolveDesktopRuntimeRoot({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    ...process.env.DSH_DESKTOP_RUNTIME_ROOT === undefined
      ? {}
      : { stagedRuntimeRoot: process.env.DSH_DESKTOP_RUNTIME_ROOT },
  })
  const controller = new DesktopBackendController({ runtimeRoot, userData: app.getPath('userData') })
  process.once('exit', () => { controller.terminateForHostExit() })
  let currentWindow: BrowserWindow | undefined

  const startBackend = async (): Promise<string> => {
    while (true) {
      try {
        return await controller.start()
      } catch (error) {
        const result = await dialog.showMessageBox({
          type: 'error', title: 'DeepSeek Harness 客户端 启动失败',
          message: error instanceof Error ? error.message : String(error),
          detail: controller.diagnostics.tail(), buttons: ['重试', '打开日志', '退出'],
          defaultId: 0, cancelId: 2, noLink: true,
        })
        if (result.response === 0) continue
        if (result.response === 1) {
          shell.showItemInFolder(controller.diagnostics.currentPath)
          continue
        }
        throw error
      }
    }
  }

  const createWindow = async (origin: ManagedBackendOrigin): Promise<BrowserWindow> => {
    const displays = screen.getAllDisplays().map(display => display.workArea)
    const initialBounds = loadWindowBounds(app.getPath('userData'), displays)
    return createDesktopWindow({
      BrowserWindow, session: session.defaultSession,
      openExternal: url => shell.openExternal(url),
      reportExternalError: (error) => { console.error('desktop: external link failed', error) },
      isPackaged: app.isPackaged,
      ...initialBounds === undefined ? {} : { initialBounds },
      persistBounds: (bounds) => { saveWindowBounds(app.getPath('userData'), bounds) },
    }, origin)
  }

  void runDesktopShell({
    app, endpoint: startBackend,
    createWindow: async (origin) => {
      currentWindow = await createWindow(origin)
      return currentWindow
    },
  }).then((result) => {
    if (result.kind === 'secondary') return
    installApplicationLifecycle({
      app, controller, dialog, shell,
      setMenu: (template) => { Menu.setApplicationMenu(Menu.buildFromTemplate(template)) },
      currentWindow: () => currentWindow,
      replaceWindow: async (origin) => {
        const previous = currentWindow
        currentWindow = await createWindow(origin)
        previous?.destroy()
      },
    })
  }).catch(async (error: unknown) => {
    console.error(error instanceof Error ? error : new Error(String(error)))
    await controller.stop().catch(() => { controller.terminateForHostExit() })
    app.quit()
  })
}

/** Electron entry that exits Squirrel maintenance invocations before product startup. */

import { app } from 'electron'
import squirrelStartup from 'electron-squirrel-startup'

if (squirrelStartup) {
  app.quit()
} else {
  void import('./application.ts').then(({ startDesktopApplication }) => {
    startDesktopApplication()
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error : new Error(String(error)))
    app.quit()
  })
}

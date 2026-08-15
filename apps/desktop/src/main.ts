/** Electron entry that starts the desktop product. */

import { app } from 'electron'
void import('./application.ts').then(({ startDesktopApplication }) => {
  startDesktopApplication()
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error : new Error(String(error)))
  app.quit()
})

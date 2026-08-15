/** Build the assisted Windows x64 NSIS installer from the hardened package. */

import { build, createTargets, Platform, type Configuration } from 'electron-builder'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveWindowsSigning } from '../forge-signing.ts'

if (process.platform !== 'win32') throw new Error('desktop installer creation requires Windows')
const root = resolve(import.meta.dirname, '..')
const output = join(root, 'out', 'make')
const signing = resolveWindowsSigning(process.env)
const config: Configuration = {
  appId: 'com.deepseek.DeepSeekHarness',
  productName: 'DeepSeek Harness 客户端',
  artifactName: 'DeepSeek-Harness-Setup-x64.${ext}',
  directories: { output },
  win: {
    executableName: 'DeepSeek Harness',
    signAndEditExecutable: false,
    ...(signing === undefined ? {} : {
      certificateFile: signing.certificateFile,
      certificatePassword: signing.certificatePassword,
      timeStampServer: signing.timestampServer,
      forceCodeSigning: true,
    }),
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    allowElevation: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'DeepSeek Harness 客户端',
    uninstallDisplayName: 'DeepSeek Harness 客户端',
    runAfterFinish: true,
  },
}

rmSync(output, { force: true, recursive: true })
const artifacts = await build({
  projectDir: root,
  prepackaged: join(root, 'out', 'DeepSeek Harness-win32-x64'),
  targets: createTargets([Platform.WINDOWS], 'nsis', 'x64'),
  config,
})
if (!artifacts.some(path => path.endsWith('DeepSeek-Harness-Setup-x64.exe'))) {
  throw new Error('NSIS did not produce DeepSeek-Harness-Setup-x64.exe')
}
console.log(`desktop NSIS installer: ${artifacts.join(', ')}`)

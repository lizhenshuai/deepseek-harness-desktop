/** Package the desktop app with Forge's Packager dependency before `make --skip-package`. */

import { flipFuses } from '@electron/fuses'
import packager from '@electron/packager'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import forgeConfig, { DESKTOP_FUSE_CONFIG } from '../forge.config.ts'

if (process.platform !== 'win32') throw new Error('desktop packaging requires Windows')
const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  devDependencies?: Record<string, string>
}
const electronVersion = manifest.devDependencies?.electron
if (electronVersion === undefined || !/^\d+\.\d+\.\d+$/.test(electronVersion)) {
  throw new Error('desktop Electron dependency must be an exact version')
}
const output = await packager({
  ...forgeConfig.packagerConfig,
  dir: root,
  out: join(root, 'out'),
  platform: 'win32',
  arch: 'x64',
  electronVersion,
  overwrite: true,
})
if (output.length !== 1) throw new Error(`expected one packaged desktop path, found ${String(output.length)}`)
const executable = join(output[0], 'DeepSeek Harness.exe')
await flipFuses(executable, DESKTOP_FUSE_CONFIG)
console.log(`desktop packaged: ${output[0]}`)

import { isAbsolute, resolve } from 'node:path'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { resolveWindowsSigning } from './forge-signing.ts'

const runtimeRoot = resolve(
  process.env.DSH_DESKTOP_PACKAGE_RUNTIME_ROOT
    ?? resolve(import.meta.dirname, '../../dist/desktop-runtime/windows-x64/runtime'),
)
const windowsSign = resolveWindowsSigning(process.env)
const electronZipDir = process.env.DSH_DESKTOP_ELECTRON_ZIP_DIR
if (electronZipDir !== undefined && !isAbsolute(electronZipDir)) {
  throw new Error('DSH_DESKTOP_ELECTRON_ZIP_DIR must be an absolute path')
}

/** Electron package and assisted NSIS installer configuration. */
export const DESKTOP_FUSE_CONFIG = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
} as const

const config: ForgeConfig = {
  rebuildConfig: { onlyModules: [] },
  packagerConfig: {
    asar: true,
    prune: false,
    executableName: 'DeepSeek Harness',
    ...(electronZipDir === undefined ? {} : { electronZipDir: resolve(electronZipDir) }),
    extraResource: [runtimeRoot, resolve(import.meta.dirname, '../../LICENSE'), resolve(import.meta.dirname, '../../THIRD_PARTY_NOTICES.md')],
    win32metadata: {
      CompanyName: 'DeepSeek Harness contributors',
      FileDescription: 'DeepSeek Harness desktop client',
      InternalName: 'DeepSeekHarness',
      OriginalFilename: 'DeepSeek Harness.exe',
      ProductName: 'DeepSeek Harness',
    },
    ...(windowsSign === undefined ? {} : { windowsSign }),
    ignore: [
      /^\/(?:assets|node_modules|src|tests)(?:\/|$)/,
      /^\/(?:forge-signing\.ts|forge\.config\.ts|tsconfig\.json|tsdown\.config\.ts|README(?:\.zh)?\.md|README\.i18n\.yaml)$/,
      /^\/lib\/types(?:\/|$)/,
      /^\/lib\/tsconfig\.tsbuildinfo$/,
    ],
  },
  makers: [],
  plugins: [
    new FusesPlugin(DESKTOP_FUSE_CONFIG),
  ],
}

export default config

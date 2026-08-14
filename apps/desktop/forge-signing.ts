/** Validated optional Authenticode configuration shared by Packager and Squirrel. */

import { lstatSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export interface WindowsSigningEnvironment {
  readonly DSH_WINDOWS_CERTIFICATE_FILE?: string
  readonly DSH_WINDOWS_CERTIFICATE_PASSWORD?: string
  readonly DSH_WINDOWS_SIGN_REQUIRED?: string
}

export interface WindowsSigningOptions {
  readonly certificateFile: string
  readonly certificatePassword: string
  readonly timestampServer: string
}

/** Resolve an all-or-nothing signing configuration; unsigned developer and PR builds need no certificate. */
export function resolveWindowsSigning(environment: WindowsSigningEnvironment): WindowsSigningOptions | undefined {
  const required = environment.DSH_WINDOWS_SIGN_REQUIRED
  if (required !== undefined && required !== '0' && required !== '1') {
    throw new Error('DSH_WINDOWS_SIGN_REQUIRED must be 0, 1, or absent')
  }
  const file = environment.DSH_WINDOWS_CERTIFICATE_FILE
  const password = environment.DSH_WINDOWS_CERTIFICATE_PASSWORD
  if (file === undefined && password === undefined) {
    if (required === '1') throw new Error('Windows signing is required but no certificate was configured')
    return undefined
  }
  if (file === undefined || password === undefined || password.length === 0) {
    throw new Error('DSH_WINDOWS_CERTIFICATE_FILE and DSH_WINDOWS_CERTIFICATE_PASSWORD must be configured together')
  }
  if (!isAbsolute(file)) throw new Error('DSH_WINDOWS_CERTIFICATE_FILE must be an absolute path')
  const certificateFile = resolve(file)
  const stat = lstatSync(certificateFile)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('DSH_WINDOWS_CERTIFICATE_FILE must be a regular file')
  return { certificateFile, certificatePassword: password, timestampServer: 'http://timestamp.digicert.com' }
}

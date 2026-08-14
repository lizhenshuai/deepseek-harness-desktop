import { closeSync, mkdtempSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveWindowsSigning } from '../forge-signing.ts'

describe('desktop Windows signing configuration', () => {
  it('permits unsigned builds unless signing is required', () => {
    expect(resolveWindowsSigning({})).toBeUndefined()
    expect(() => resolveWindowsSigning({ DSH_WINDOWS_SIGN_REQUIRED: '1' })).toThrow('required')
  })

  it('rejects partial and relative certificate configuration', () => {
    expect(() => resolveWindowsSigning({ DSH_WINDOWS_CERTIFICATE_FILE: 'certificate.pfx' })).toThrow('configured together')
    expect(() => resolveWindowsSigning({
      DSH_WINDOWS_CERTIFICATE_FILE: 'certificate.pfx', DSH_WINDOWS_CERTIFICATE_PASSWORD: 'secret',
    })).toThrow('absolute')
  })

  it('returns one shared configuration for a regular certificate file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-signing-')), 'certificate.pfx')
    closeSync(openSync(file, 'w'))
    expect(resolveWindowsSigning({
      DSH_WINDOWS_CERTIFICATE_FILE: file, DSH_WINDOWS_CERTIFICATE_PASSWORD: 'secret', DSH_WINDOWS_SIGN_REQUIRED: '1',
    })).toMatchObject({ certificateFile: file, certificatePassword: 'secret' })
  })
})

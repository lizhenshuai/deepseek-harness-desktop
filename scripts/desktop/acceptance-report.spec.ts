import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BASE_ASSERTIONS, parseDesktopAcceptanceReport, PROVIDER_ASSERTIONS, SIGNED_ASSERTIONS, verifyDesktopAcceptanceReports,
} from './acceptance-report.ts'

const DIGEST = 'a'.repeat(64)

describe('desktop acceptance report', () => {
  it('accepts a complete signed Windows matrix plus the protected provider lane', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-acceptance-report-'))
    const paths = [
      writeReport(root, 'win10.json', report('windows-10', 'signed')),
      writeReport(root, 'win11.json', report('windows-11', 'signed')),
      writeReport(root, 'provider.json', report('windows-11', 'provider')),
    ]
    expect(verifyDesktopAcceptanceReports(paths, {
      expectedSetupSha256: DIGEST,
      requiredOs: ['windows-10', 'windows-11'],
      requireSigned: true,
      requireProvider: true,
    })).toHaveLength(3)
  })

  it('rejects omitted, failed, duplicate, secret-bearing, and wrong-artifact evidence', () => {
    const base = report('windows-11', 'unsigned')
    expect(() => parseDesktopAcceptanceReport({ ...base, extra: true })).toThrow('unexpected or missing fields')
    expect(() => parseDesktopAcceptanceReport({
      ...base, assertions: [...base.assertions, base.assertions[0]],
    })).toThrow('duplicate ids')

    const cases = [
      { name: 'omitted', value: { ...base, assertions: base.assertions.slice(1) }, error: 'omitted artifact.sha256' },
      {
        name: 'failed', value: {
          ...base, assertions: base.assertions.map(assertion => assertion.id === 'launch.web-ui'
            ? { ...assertion, status: 'failed' }
            : assertion),
        }, error: 'failed launch.web-ui',
      },
      { name: 'secret', value: { ...base, secretMatches: ['credential canary'] }, error: 'contains secret matches' },
      { name: 'digest', value: { ...base, candidate: { ...base.candidate, setupSha256: 'c'.repeat(64) } }, error: 'different Setup.exe' },
    ] as const
    for (const testCase of cases) {
      const root = mkdtempSync(join(tmpdir(), `dsh-acceptance-${testCase.name}-`))
      const path = writeReport(root, 'report.json', testCase.value)
      expect(() => verifyDesktopAcceptanceReports([path], {
        expectedSetupSha256: DIGEST,
        requiredOs: ['windows-11'],
        requireSigned: false,
        requireProvider: false,
      })).toThrow(testCase.error)
    }
  })

  it('requires both operating systems, signed evidence, and the Windows 11 provider lane when requested', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-acceptance-policy-'))
    const unsigned = writeReport(root, 'unsigned.json', report('windows-11', 'unsigned'))
    expect(() => verifyDesktopAcceptanceReports([unsigned], {
      expectedSetupSha256: DIGEST,
      requiredOs: ['windows-10', 'windows-11'],
      requireSigned: false,
      requireProvider: false,
    })).toThrow('no lifecycle result for windows-10')
    expect(() => verifyDesktopAcceptanceReports([unsigned], {
      expectedSetupSha256: DIGEST,
      requiredOs: ['windows-11'],
      requireSigned: true,
      requireProvider: false,
    })).toThrow('did not validate a signed candidate')

    const signed = writeReport(root, 'signed.json', report('windows-11', 'signed'))
    expect(() => verifyDesktopAcceptanceReports([signed], {
      expectedSetupSha256: DIGEST,
      requiredOs: ['windows-11'],
      requireSigned: true,
      requireProvider: true,
    })).toThrow('no Windows 11 provider result')
  })
})

function report(os: 'windows-10' | 'windows-11', lane: 'unsigned' | 'signed' | 'provider') {
  const ids = [...BASE_ASSERTIONS, ...lane === 'unsigned' ? [] : SIGNED_ASSERTIONS, ...lane === 'provider' ? PROVIDER_ASSERTIONS : []]
  return {
    schemaVersion: 1,
    runnerVersion: '1.0.0',
    startedAt: '2026-08-14T00:00:00.000Z',
    finishedAt: '2026-08-14T00:05:00.000Z',
    lane,
    os: { family: os, edition: 'Professional', build: 'test-build', architecture: 'x64', imageId: `${os}-sealed` },
    account: { nameClass: 'space-and-non-ascii', administrator: false },
    candidate: { setupSha256: DIGEST, installerType: 'nsis-assisted', signature: lane === 'unsigned' ? 'unsigned' : 'valid' },
    paths: {
      installRoot: 'C:\\Users\\测试 User\\AppData\\Local\\Programs\\DeepSeek Harness Acceptance',
      userData: 'C:\\Users\\测试 User\\AppData\\Roaming\\DeepSeek Harness',
      dshHome: 'C:\\Users\\测试 User\\AppData\\Roaming\\DeepSeek Harness\\harness',
    },
    assertions: ids.map(id => ({ id, status: 'passed', observed: `${id} observed` })),
    secretMatches: [],
  }
}

function writeReport(root: string, name: string, value: unknown): string {
  const path = join(root, name)
  writeFileSync(path, `${JSON.stringify(value)}\n`)
  return path
}

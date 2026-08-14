/** Runtime validation for Windows desktop release-acceptance evidence. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SHA256 = /^[0-9a-f]{64}$/u
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u

export const BASE_ASSERTIONS = [
  'artifact.sha256',
  'environment.windows-x64',
  'environment.clean',
  'install.ordinary-user',
  'install.shortcut',
  'launch.web-ui',
  'launch.missing-credential',
  'launch.offline',
  'launch.loopback-random',
  'renderer.isolated',
  'runtime.client-catalog',
  'lifecycle.restart',
  'lifecycle.crash-recovery',
  'lifecycle.sign-out',
  'upgrade.application-replaced',
  'upgrade.data-preserved',
  'uninstall.application-removed',
  'uninstall.data-preserved',
  'reinstall.data-restored',
  'processes.quiescent',
  'artifacts.secret-free',
] as const

export const SIGNED_ASSERTIONS = [
  'signature.setup-valid',
  'signature.application-valid',
  'signature.publisher',
  'signature.timestamp',
] as const

export const PROVIDER_ASSERTIONS = [
  'provider.conversation',
  'provider.session-restored',
  'tools.filesystem',
  'tools.powershell',
  'tools.worker-thread',
] as const

export type DesktopAcceptanceOs = 'windows-10' | 'windows-11'
type DesktopAcceptanceLane = 'unsigned' | 'signed' | 'provider'

interface DesktopAcceptanceAssertion {
  readonly id: string
  readonly status: 'passed' | 'failed'
  readonly observed: string
}

export interface DesktopAcceptanceReport {
  readonly schemaVersion: 1
  readonly runnerVersion: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly lane: DesktopAcceptanceLane
  readonly os: {
    readonly family: DesktopAcceptanceOs
    readonly edition: string
    readonly build: string
    readonly architecture: 'x64'
    readonly imageId: string
  }
  readonly account: {
    readonly nameClass: 'space-and-non-ascii'
    readonly administrator: false
  }
  readonly candidate: {
    readonly setupSha256: string
    readonly nupkgSha256: string
    readonly signature: 'unsigned' | 'valid'
  }
  readonly paths: {
    readonly installRoot: string
    readonly userData: string
    readonly dshHome: string
  }
  readonly assertions: readonly DesktopAcceptanceAssertion[]
  readonly secretMatches: readonly string[]
}

export interface DesktopAcceptancePolicy {
  readonly expectedSetupSha256: string
  readonly requiredOs: readonly DesktopAcceptanceOs[]
  readonly requireSigned: boolean
  readonly requireProvider: boolean
}

/** Read and validate a report set, including cross-machine release requirements. */
export function verifyDesktopAcceptanceReports(
  reportPaths: readonly string[],
  policy: DesktopAcceptancePolicy,
): readonly DesktopAcceptanceReport[] {
  if (!SHA256.test(policy.expectedSetupSha256)) throw new Error('acceptance policy requires a lowercase SHA-256 digest')
  if (reportPaths.length === 0) throw new Error('acceptance requires at least one report')
  const reports = reportPaths.map(path => parseDesktopAcceptanceReport(JSON.parse(readFileSync(resolve(path), 'utf8'))))
  for (const report of reports) verifyReport(report, policy)
  for (const os of policy.requiredOs) {
    if (!reports.some(report => report.os.family === os && report.lane !== 'provider')) {
      throw new Error(`acceptance report set has no lifecycle result for ${os}`)
    }
  }
  if (policy.requireProvider && !reports.some(report => report.lane === 'provider' && report.os.family === 'windows-11')) {
    throw new Error('acceptance report set has no Windows 11 provider result')
  }
  return reports
}

/** Validate the external JSON boundary and return its typed value. */
export function parseDesktopAcceptanceReport(value: unknown): DesktopAcceptanceReport {
  const root = object(value, 'report')
  exactKeys(root, [
    'schemaVersion', 'runnerVersion', 'startedAt', 'finishedAt', 'lane', 'os', 'account', 'candidate', 'paths', 'assertions',
    'secretMatches',
  ], 'report')
  if (root.schemaVersion !== 1) throw new Error('report.schemaVersion must be 1')
  const runnerVersion = nonEmptyString(root.runnerVersion, 'report.runnerVersion')
  const startedAt = timestamp(root.startedAt, 'report.startedAt')
  const finishedAt = timestamp(root.finishedAt, 'report.finishedAt')
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error('report.finishedAt precedes report.startedAt')
  const lane = member(root.lane, ['unsigned', 'signed', 'provider'] as const, 'report.lane')
  const os = parseOs(root.os)
  const account = parseAccount(root.account)
  const candidate = parseCandidate(root.candidate)
  const paths = parsePaths(root.paths)
  if (!Array.isArray(root.assertions)) throw new Error('report.assertions must be an array')
  const assertions = root.assertions.map((assertion, index) => parseAssertion(assertion, index))
  if (new Set(assertions.map(assertion => assertion.id)).size !== assertions.length) {
    throw new Error('report.assertions contains duplicate ids')
  }
  if (!Array.isArray(root.secretMatches) || !root.secretMatches.every(match => typeof match === 'string')) {
    throw new Error('report.secretMatches must be a string array')
  }
  return {
    schemaVersion: 1, runnerVersion, startedAt, finishedAt, lane, os, account, candidate, paths, assertions,
    secretMatches: root.secretMatches,
  }
}

function verifyReport(report: DesktopAcceptanceReport, policy: DesktopAcceptancePolicy): void {
  if (report.candidate.setupSha256 !== policy.expectedSetupSha256) {
    throw new Error(`${report.os.family}/${report.lane} reports a different Setup.exe digest`)
  }
  if (report.secretMatches.length !== 0) throw new Error(`${report.os.family}/${report.lane} evidence contains secret matches`)
  const required: string[] = [...BASE_ASSERTIONS]
  if (policy.requireSigned || report.lane !== 'unsigned') required.push(...SIGNED_ASSERTIONS)
  if (report.lane === 'provider') required.push(...PROVIDER_ASSERTIONS)
  if ((policy.requireSigned || report.lane !== 'unsigned') && report.candidate.signature !== 'valid') {
    throw new Error(`${report.os.family}/${report.lane} did not validate a signed candidate`)
  }
  const byId = new Map(report.assertions.map(assertion => [assertion.id, assertion]))
  for (const id of required) {
    const assertion = byId.get(id)
    if (assertion === undefined) throw new Error(`${report.os.family}/${report.lane} omitted ${id}`)
    if (assertion.status !== 'passed') throw new Error(`${report.os.family}/${report.lane} failed ${id}: ${assertion.observed}`)
  }
}

function parseOs(value: unknown): DesktopAcceptanceReport['os'] {
  const os = object(value, 'report.os')
  exactKeys(os, ['family', 'edition', 'build', 'architecture', 'imageId'], 'report.os')
  return {
    family: member(os.family, ['windows-10', 'windows-11'] as const, 'report.os.family'),
    edition: nonEmptyString(os.edition, 'report.os.edition'),
    build: nonEmptyString(os.build, 'report.os.build'),
    architecture: member(os.architecture, ['x64'] as const, 'report.os.architecture'),
    imageId: nonEmptyString(os.imageId, 'report.os.imageId'),
  }
}

function parseAccount(value: unknown): DesktopAcceptanceReport['account'] {
  const account = object(value, 'report.account')
  exactKeys(account, ['nameClass', 'administrator'], 'report.account')
  if (account.administrator !== false) throw new Error('report.account.administrator must be false')
  return {
    nameClass: member(account.nameClass, ['space-and-non-ascii'] as const, 'report.account.nameClass'),
    administrator: false,
  }
}

function parseCandidate(value: unknown): DesktopAcceptanceReport['candidate'] {
  const candidate = object(value, 'report.candidate')
  exactKeys(candidate, ['setupSha256', 'nupkgSha256', 'signature'], 'report.candidate')
  const setupSha256 = nonEmptyString(candidate.setupSha256, 'report.candidate.setupSha256')
  const nupkgSha256 = nonEmptyString(candidate.nupkgSha256, 'report.candidate.nupkgSha256')
  if (!SHA256.test(setupSha256) || !SHA256.test(nupkgSha256)) throw new Error('report candidate digests must be lowercase SHA-256')
  return {
    setupSha256, nupkgSha256,
    signature: member(candidate.signature, ['unsigned', 'valid'] as const, 'report.candidate.signature'),
  }
}

function parsePaths(value: unknown): DesktopAcceptanceReport['paths'] {
  const paths = object(value, 'report.paths')
  exactKeys(paths, ['installRoot', 'userData', 'dshHome'], 'report.paths')
  return {
    installRoot: absoluteWindowsPath(paths.installRoot, 'report.paths.installRoot'),
    userData: absoluteWindowsPath(paths.userData, 'report.paths.userData'),
    dshHome: absoluteWindowsPath(paths.dshHome, 'report.paths.dshHome'),
  }
}

function parseAssertion(value: unknown, index: number): DesktopAcceptanceAssertion {
  const label = `report.assertions[${String(index)}]`
  const assertion = object(value, label)
  exactKeys(assertion, ['id', 'status', 'observed'], label)
  return {
    id: nonEmptyString(assertion.id, `${label}.id`),
    status: member(assertion.status, ['passed', 'failed'] as const, `${label}.status`),
    observed: nonEmptyString(assertion.observed, `${label}.observed`),
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unexpected or missing fields`)
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value
}

function timestamp(value: unknown, label: string): string {
  const result = nonEmptyString(value, label)
  if (!ISO_TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) throw new Error(`${label} must be an ISO UTC timestamp`)
  return result
}

function absoluteWindowsPath(value: unknown, label: string): string {
  const result = nonEmptyString(value, label)
  if (!/^[A-Za-z]:\\/u.test(result)) throw new Error(`${label} must be an absolute Windows path`)
  return result
}

function member<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(`${label} has an unsupported value`)
  return value
}

/** CLI for the fail-closed Windows desktop release-acceptance report verifier. */

import { verifyDesktopAcceptanceReports, type DesktopAcceptanceOs } from './acceptance-report.ts'

const values = parseArguments(process.argv.slice(2))
const reports = verifyDesktopAcceptanceReports(values.reports, {
  expectedSetupSha256: values.setupSha256,
  requiredOs: values.requiredOs,
  requireSigned: values.signed,
  requireProvider: values.provider,
})
console.log(`desktop acceptance: ${String(reports.length)} report(s), Setup.exe ${values.setupSha256}`)

interface Arguments {
  reports: string[]
  setupSha256: string
  requiredOs: DesktopAcceptanceOs[]
  signed: boolean
  provider: boolean
}

function parseArguments(argv: readonly string[]): Arguments {
  const reports: string[] = []
  const requiredOs: DesktopAcceptanceOs[] = []
  let setupSha256: string | undefined
  let signed = false
  let provider = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--report') reports.push(requireValue(argv, ++index, argument))
    else if (argument === '--setup-sha256') setupSha256 = requireValue(argv, ++index, argument)
    else if (argument === '--require-os') requiredOs.push(parseOs(requireValue(argv, ++index, argument)))
    else if (argument === '--signed') signed = true
    else if (argument === '--provider') provider = true
    else throw new Error(`unknown desktop acceptance argument: ${String(argument)}`)
  }
  if (setupSha256 === undefined) throw new Error('desktop acceptance requires --setup-sha256')
  if (requiredOs.length === 0) throw new Error('desktop acceptance requires at least one --require-os')
  return { reports, setupSha256, requiredOs, signed, provider }
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parseOs(value: string): DesktopAcceptanceOs {
  if (value === 'windows-10' || value === 'windows-11') return value
  throw new Error(`unsupported desktop acceptance OS: ${value}`)
}

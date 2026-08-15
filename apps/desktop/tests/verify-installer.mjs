/** Structural and Authenticode inspection for Task 5 Windows x64 artifacts. */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, delimiter, isAbsolute, join, relative, resolve } from 'node:path'

if (process.platform !== 'win32') throw new Error('desktop installer inspection requires Windows')
const outputArgument = process.argv[2]
if (outputArgument === undefined) throw new Error('usage: verify-installer.mjs <forge-output-directory>')
const outputRoot = resolve(outputArgument)
const makeRoot = join(outputRoot, 'make')
const files = collect(makeRoot)
const setup = exactly(files, path => basename(path) === 'DeepSeek-Harness-Setup-x64.exe', 'Setup.exe')
const sums = exactly(files, path => path.endsWith('SHA256SUMS.txt'), 'SHA256SUMS.txt')
if (files.some(path => path.toLowerCase().endsWith('.msi'))) throw new Error('Task 5 must not produce an MSI')
if (files.some(path => path.endsWith('-full.nupkg') || path.endsWith('RELEASES'))) {
  throw new Error('NSIS output cannot contain Squirrel artifacts')
}
const expectedRows = [setup].map((path) => {
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
  return `${hash}  ${relative(makeRoot, path).replaceAll('\\', '/')}`
})
if (readFileSync(sums, 'utf8') !== `${expectedRows.join('\n')}\n`) throw new Error('SHA256SUMS.txt does not match the maker output')

const expectedStatus = process.env.DSH_WINDOWS_EXPECT_SIGNED === '1' ? 'Valid' : 'NotSigned'
const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR
const programFiles = process.env.ProgramFiles
if (windowsRoot === undefined || programFiles === undefined) throw new Error('Windows system paths are unavailable')
const status = execFileSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  '(Get-AuthenticodeSignature -LiteralPath $env:DSH_AUTHENTICODE_PATH).Status.ToString()',
], {
  encoding: 'utf8',
  env: {
    ...process.env,
    DSH_AUTHENTICODE_PATH: setup,
    PSModulePath: [
      join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
      join(programFiles, 'WindowsPowerShell', 'Modules'),
    ].join(delimiter),
  },
}).trim()
if (status !== expectedStatus) throw new Error(`Setup.exe Authenticode status is ${status}, expected ${expectedStatus}`)
console.log(`desktop installer verified: ${setup}`)

function exactly(paths, predicate, label) {
  const found = paths.filter(predicate)
  if (found.length !== 1) throw new Error(`expected one ${label}, found ${String(found.length)}`)
  return found[0]
}

function collect(path) {
  if (!isAbsolute(path)) throw new Error(`installer inspection path must be absolute: ${path}`)
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error(`installer output cannot contain links: ${path}`)
  if (stat.isFile()) return [path]
  if (!stat.isDirectory()) throw new Error(`unexpected installer output entry: ${path}`)
  return readdirSync(path).flatMap(entry => collect(join(path, entry)))
}

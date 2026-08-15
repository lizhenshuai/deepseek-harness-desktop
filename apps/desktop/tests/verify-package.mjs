/** Inspection gate for the Forge-packaged Windows x64 application. */

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses'

const outputArgument = process.argv[2]
if (process.platform !== 'win32') throw new Error('desktop package inspection requires Windows')
if (outputArgument === undefined) throw new Error('usage: verify-package.mjs <forge-output-directory>')

const outputRoot = resolve(outputArgument)
const candidates = readdirSync(outputRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.endsWith('-win32-x64'))
  .map(entry => join(outputRoot, entry.name))
if (candidates.length !== 1) {
  throw new Error(`expected one packaged Windows x64 application under ${outputRoot}, found ${String(candidates.length)}`)
}

const applicationRoot = candidates[0]
const resources = join(applicationRoot, 'resources')
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const executable = regularFile(join(applicationRoot, 'DeepSeek Harness.exe'))
regularFile(join(resources, 'app.asar'))
for (const legalFile of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  const packaged = regularFile(join(resources, legalFile))
  const source = regularFile(join(repositoryRoot, legalFile))
  if (!readFileSync(packaged).equals(readFileSync(source))) {
    throw new Error(`packaged ${legalFile} does not match the repository source`)
  }
}
const runtime = join(resources, 'runtime')
const manifest = regularFile(join(runtime, 'runtime-manifest.json'))
regularFile(join(runtime, 'node/node.exe'))
regularFile(join(runtime, 'app/package.json'))

const parsedManifest = JSON.parse(readFileSync(manifest, 'utf8'))
if (parsedManifest.schemaVersion !== 1
  || parsedManifest.target?.platform !== 'win32'
  || parsedManifest.target?.arch !== 'x64') {
  throw new Error('packaged runtime manifest does not describe the Task 2 Windows x64 runtime')
}

const fuses = await getCurrentFuseWire(executable)
if (fuses.version !== FuseVersion.V1) throw new Error(`unexpected Electron fuse version: ${fuses.version}`)
const expected = new Map([
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
])
for (const [option, state] of expected) {
  if (fuses[option] !== state) throw new Error(`Electron fuse ${String(option)} has state ${String(fuses[option])}`)
}

console.log(`desktop package verified: ${applicationRoot}`)

function regularFile(path) {
  if (!isAbsolute(path)) throw new Error(`package inspection path must be absolute: ${path}`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`expected regular packaged file: ${path}`)
  return path
}

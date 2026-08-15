/** Write a SHA-256 row for the NSIS installer. */

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

const rootArgument = process.argv[2]
if (rootArgument === undefined) throw new Error('usage: write-installer-checksums.mjs <make-output-directory>')
const root = resolve(rootArgument)
const files = collect(root).filter(path => !path.endsWith('SHA256SUMS.txt')).sort()
const installers = files.filter(path => basename(path) === 'DeepSeek-Harness-Setup-x64.exe')
if (installers.length !== 1) throw new Error(`expected one NSIS installer, found ${String(installers.length)}`)
const rows = installers.map((path) => {
  const name = relative(root, path).replaceAll('\\', '/')
  return `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${name}`
})
writeFileSync(join(root, 'SHA256SUMS.txt'), `${rows.join('\n')}\n`)

function collect(path) {
  if (!isAbsolute(path)) throw new Error(`installer output path must be absolute: ${path}`)
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error(`installer output cannot contain links: ${path}`)
  if (stat.isFile()) return [path]
  if (!stat.isDirectory()) throw new Error(`unexpected installer output entry: ${path}`)
  return readdirSync(path).flatMap(entry => collect(join(path, entry)))
}

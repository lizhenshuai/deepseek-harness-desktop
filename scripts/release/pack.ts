/**
 * Pack one release family's whole publish set into a single directory, in
 * publish order, and record that order for the publish step.
 *
 * The pack step is the release boundary: it runs without credentials, produces
 * every tarball from one commit, and hands the publish step exactly those bytes
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 */

import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { releaseFamily, tarballName, type ReleaseFamily, type ReleaseMember } from './families.ts'
import { isEntry, run } from './process.ts'
import { PUBLISH_ORDER_FILE, tarballFiles } from './tarball.ts'

/** Where pack output lands when `--out` is omitted. */
const DEFAULT_OUTPUT = 'dist/npm'

/**
 * Sort JSON object keys recursively while retaining array order.
 * @param value - JSON-compatible value to normalize.
 * @returns A structurally equal value with deterministic object order.
 */
export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalizeJson(entry)]))
}

/**
 * Replace a package manager's order-unstable exported manifest with a canonical npm archive.
 * @param tarball - npm archive to normalize in place.
 */
export function normalizeTarball(tarball: string): void {
  const workRoot = mkdtempSync(join(tmpdir(), 'dsh-release-pack-'))
  try {
    run('tar', ['-xzf', tarball, '-C', workRoot])
    const packageRoot = join(workRoot, 'package')
    const manifestPath = join(packageRoot, 'package.json')
    if (!existsSync(manifestPath)) throw new Error(`${tarball} has no package/package.json`)
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeFileSync(manifestPath, `${JSON.stringify(canonicalizeJson(manifest), undefined, 2)}\n`)

    const output = join(workRoot, 'normalized')
    mkdirSync(output)
    run('npm', [
      'pack',
      '--ignore-scripts',
      '--workspaces=false',
      '--cache',
      join(workRoot, 'npm-cache'),
      '--pack-destination',
      output,
    ], { cwd: packageRoot })
    const normalized = join(output, basename(tarball))
    if (!existsSync(normalized)) throw new Error(`${tarball} normalization produced no ${basename(tarball)}`)
    copyFileSync(normalized, tarball)
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }
}

/**
 * Pack one member and check what its tarball carries.
 * @param family - the release family being packed.
 * @param member - the member to pack.
 * @param destination - absolute output directory.
 * @returns The tarball filename.
 */
function packMember(family: ReleaseFamily, member: ReleaseMember, destination: string): string {
  run('pnpm', ['--dir', member.directory, 'pack', '--pack-destination', destination])

  const filename = tarballName(member)
  const tarball = join(destination, filename)
  if (!existsSync(tarball)) throw new Error(`${member.name} produced no tarball at ${tarball}`)
  normalizeTarball(tarball)
  family.validatePayload(member, tarballFiles(tarball))
  return filename
}

/** Pack the family named by `--family` into `--out`. */
function main(): void {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.family === undefined) throw new Error('usage: pack.ts --family <dsh|vendor> [--out dist/npm]')

  const family = releaseFamily(values.family)
  const root = process.cwd()
  const destination = resolve(root, values.out ?? DEFAULT_OUTPUT)
  const members = family.publishOrder(family.members(root))
  family.verifyVersions(members)

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })

  const order: string[] = []
  for (const member of members) order.push(packMember(family, member, destination))
  writeFileSync(join(destination, PUBLISH_ORDER_FILE), `${order.join('\n')}\n`)

  console.log(`release pack: family ${family.id}, ${String(order.length)} tarball(s) in ${values.out ?? DEFAULT_OUTPUT}`)
}

if (isEntry(import.meta.url)) main()

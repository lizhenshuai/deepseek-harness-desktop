/**
 * Install packed tarballs into a throwaway consumer outside the repository and
 * drive the installed executable with plain Node.
 *
 * Every tarball the installed tree needs comes from `--from`, so the only
 * registry traffic is for external dependencies. That matters beyond hermetic
 * verification: the harness packages declare the vendored framework as a peer,
 * those packages live in another release sequence, and this job must not depend
 * on the registry already carrying versions that match — one pull request may
 * bump both families before either publishes — so a dsh verification passes the
 * vendored family's pack output too, while publishing only its own
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * What this proves is that `files` selected a complete payload and that the
 * published dependency ranges resolve. A workspace link or a stale `lib/` in the
 * checkout cannot stand in for a missing file here.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { releaseFamily } from './families.ts'
import {
  installPackedTarballs, packedConsumerEnvironment, readPackedTarballs,
} from './packed-consumer.ts'
import { capture, isEntry } from './process.ts'
import { provePackedWeb } from './packed-web-proof.ts'

/** Install every tarball under `--from` and drive the `--family` entry. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      family: { type: 'string' },
      from: { type: 'string', multiple: true },
      node: { type: 'string' },
      report: { type: 'string' },
      web: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined || values.from.length === 0) {
    throw new Error('usage: verify-packed-install.ts --family <dsh|vendor> --from <packed directory> [--from ...] [--node <executable>] [--web] [--report <file>]')
  }

  const family = releaseFamily(values.family)
  const entry = family.installedEntry
  if (entry === undefined) {
    if (values.web) throw new Error(`release family ${family.id} publishes no executable for --web`)
    if (values.report !== undefined) throw new Error('--report requires --web')
    console.log(`release verify-packed-install: family ${family.id} publishes no executable, nothing to drive`)
    return
  }
  if (values.report !== undefined && !values.web) throw new Error('--report requires --web')

  const root = process.cwd()
  const packed = readPackedTarballs(values.from.map(directory => resolve(root, directory)))
  const expected = packed.find(candidate => candidate.name === entry.packageName)
  if (expected === undefined) throw new Error(`${entry.packageName} is not among the packed tarballs`)
  const node = values.node === undefined ? process.execPath : resolve(root, values.node)

  const consumerRoot = mkdtempSync(join(tmpdir(), `dsh-packed-${family.id}-`))
  try {
    writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: `dsh-packed-install-${family.id}`,
      version: '0.0.0',
      private: true,
      dependencies: Object.fromEntries(packed.map(entryPacked => [entryPacked.name, entryPacked.url])),
    }, null, 2)}\n`)

    const environment = packedConsumerEnvironment(consumerRoot)
    console.log(`release verify-packed-install: installing ${String(packed.length)} tarball(s) into ${consumerRoot}`)
    // Non-Windows release verification omits the Landlock platform packages:
    // building those artifacts requires a musl toolchain per architecture. A
    // Windows install keeps optional dependencies because Koffi uses its
    // platform package for the native implementations shipped in Web profiles;
    // npm excludes the Linux-only Landlock packages by their OS metadata.
    installPackedTarballs(node, consumerRoot, environment)

    const bin = join(consumerRoot, 'node_modules', ...entry.packageName.split('/'), entry.binPath)
    const version = capture(node, [bin, '--version'], { cwd: consumerRoot, env: environment })
    if (version !== expected.version) {
      throw new Error(`installed ${entry.packageName} --version reported ${JSON.stringify(version)}, expected ${expected.version}`)
    }
    console.log(`release verify-packed-install: installed ${entry.packageName} reports ${version}`)
    if (values.web) {
      const report = await provePackedWeb({
        node,
        bin,
        consumerRoot,
        repositoryRoot: root,
        environment,
        dshVersion: version,
        packages: packed.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
        ...(values.report === undefined ? {} : { reportPath: resolve(root, values.report) }),
      })
      console.log(
        `release verify-packed-install: packed Web runtime serves ${String(report.clientModules.length)} Client bundle(s) and ${String(report.frontendAssets.length)} browser resource(s)`,
      )
    }
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true })
  }
}

if (isEntry(import.meta.url)) await main()

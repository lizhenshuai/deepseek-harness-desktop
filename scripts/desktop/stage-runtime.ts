/** Build the manifest-sealed Windows runtime consumed by the desktop shell. */

import { createHash } from 'node:crypto'
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  installPackedTarballs, npmCliForNode, packedConsumerEnvironment, readPackedTarballs,
} from '../release/packed-consumer.ts'
import { capture, isEntry, run } from '../release/process.ts'
import {
  buildRuntimeLock, inventoryRuntime, projectRuntimePackages, publishStagedDirectory,
  readJsonObject, removeTreeSafe, resolveProductionClosure, sha256File, verifyRuntimePolicy,
  writeStableJson, type RuntimeLock, type RuntimeManifest, type RuntimeTarget,
} from './staged-runtime.ts'

const TARGETS_PATH = 'scripts/desktop/runtime-targets.json'
const LOCK_PATH = 'scripts/desktop/runtime-lock.json'
const VERIFY_SCRIPT = 'scripts/desktop/verify-staged-runtime.mjs'
const ENTRY_PACKAGE = '@deepseek-ai/dsh'

/** Stage one checksum-pinned Windows runtime from formal npm tarballs. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      target: { type: 'string', default: 'windows-x64' },
      from: { type: 'string', multiple: true },
      proof: { type: 'string' },
      out: { type: 'string' },
      'node-archive': { type: 'string' },
      'download-node': { type: 'boolean', default: false },
      'update-lock': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  if (values.from === undefined || values.from.length === 0 || values.proof === undefined || values.out === undefined) {
    throw new Error('usage: stage-runtime.ts --from <tarball directory> [--from ...] --proof <packed proof> --out <directory> (--node-archive <zip> | --download-node) [--target windows-x64] [--update-lock]')
  }
  if ((values['node-archive'] === undefined) === !values['download-node']) {
    throw new Error('select exactly one of --node-archive or --download-node')
  }

  const repositoryRoot = process.cwd()
  const target = readTarget(resolve(repositoryRoot, TARGETS_PATH), values.target)
  if (process.platform !== target.platform || process.arch !== target.arch) {
    throw new Error(`TARGET_MISMATCH: staging ${target.id} requires ${target.platform}/${target.arch}, got ${process.platform}/${process.arch}`)
  }
  const output = resolve(repositoryRoot, values.out)
  if (existsSync(output)) throw new Error(`staging output already exists: ${output}`)
  mkdirSync(dirname(output), { recursive: true })

  const workRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-stage-'), { encoding: 'utf8' })
  const stagedRoot = mkdtempSync(join(dirname(output), '.dsh-runtime-stage-'), { encoding: 'utf8' })
  let published = false
  try {
    const proofPath = resolve(repositoryRoot, values.proof)
    const proof = readPackedProof(proofPath)
    const tarballs = readPackedTarballs(values.from.map(directory => resolve(repositoryRoot, directory)))
    assertProofInputs(proof, tarballs)

    const archive = values['node-archive'] === undefined
      ? await downloadNodeArchive(target, workRoot)
      : resolve(repositoryRoot, values['node-archive'])
    if (sha256File(archive) !== target.archiveSha256) {
      throw new Error(`NODE_ARCHIVE_HASH_MISMATCH: ${archive} does not match ${target.archiveSha256}`)
    }
    const nodeDistribution = extractNodeArchive(archive, target, workRoot)
    const node = join(nodeDistribution, 'node.exe')
    assertNodeTarget(node, target)

    const consumerRoot = join(workRoot, 'consumer')
    mkdirSync(consumerRoot, { recursive: true })
    writeStableJson(join(consumerRoot, 'package.json'), {
      name: 'dsh-desktop-runtime-consumer',
      version: '0.0.0',
      private: true,
      dependencies: Object.fromEntries(tarballs.map(tarball => [tarball.name, tarball.url])),
    })
    const environment = packedConsumerEnvironment(consumerRoot)
    console.log(`desktop stage-runtime: installing ${String(tarballs.length)} tarball(s)`)
    installPackedTarballs(node, consumerRoot, environment)

    const packages = resolveProductionClosure(consumerRoot, ENTRY_PACKAGE)
    const npmVersion = capture(node, [npmCliForNode(node), '--version'], { env: environment })
    const generatedLock = buildRuntimeLock(target.id, npmVersion, consumerRoot, packages, tarballs)
    const lockPath = resolve(repositoryRoot, LOCK_PATH)
    if (values['update-lock']) writeStableJson(lockPath, generatedLock)
    assertRuntimeLock(lockPath, generatedLock)

    const runtimeRoot = join(stagedRoot, 'runtime')
    const appRoot = join(runtimeRoot, 'app')
    mkdirSync(join(runtimeRoot, 'node'), { recursive: true })
    copyFileSync(node, join(runtimeRoot, 'node', 'node.exe'))
    copyFileSync(join(nodeDistribution, 'LICENSE'), join(runtimeRoot, 'node', 'LICENSE'))
    writeStableJson(join(appRoot, 'package.json'), {
      name: 'dsh-desktop-runtime',
      version: proof.target.dshVersion,
      private: true,
      type: 'module',
    })
    projectRuntimePackages(packages, consumerRoot, appRoot)
    writeStableJson(join(runtimeRoot, 'licenses.json'), {
      schemaVersion: 1,
      packages: packages.map(runtimePackage => ({
        name: runtimePackage.name,
        version: runtimePackage.version,
        license: typeof runtimePackage.manifest.license === 'string' ? runtimePackage.manifest.license : null,
      })),
    })
    verifyRuntimePolicy(runtimeRoot, [repositoryRoot, consumerRoot, workRoot])
    const { files, executables } = inventoryRuntime(runtimeRoot)
    const lockText = readFileSync(lockPath, 'utf8')
    const manifest: RuntimeManifest = {
      schemaVersion: 1,
      target: {
        platform: target.platform,
        arch: target.arch,
        nodeVersion: target.nodeVersion,
        dshVersion: proof.target.dshVersion,
      },
      entrypoint: {
        executable: 'node/node.exe',
        script: 'app/node_modules/@deepseek-ai/dsh/lib/bin.js',
        profile: 'web',
      },
      inputs: {
        packedWebProofSha256: sha256File(proofPath),
        nodeArchiveSha256: target.archiveSha256,
        runtimeLockSha256: createTextHash(lockText),
        tarballs: tarballs.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
      },
      packages: generatedLock.packages,
      executables,
      files,
    }
    writeStableJson(join(runtimeRoot, 'runtime-manifest.json'), manifest)

    const verificationRoot = join(stagedRoot, 'verification')
    mkdirSync(verificationRoot, { recursive: true })
    copyFileSync(resolve(repositoryRoot, VERIFY_SCRIPT), join(verificationRoot, 'verify-staged-runtime.mjs'))
    copyFileSync(proofPath, join(verificationRoot, 'expected-packed-web-proof.json'))
    const verificationOutput = capture(join(runtimeRoot, 'node', 'node.exe'), [
      join(verificationRoot, 'verify-staged-runtime.mjs'),
      runtimeRoot,
      join(verificationRoot, 'expected-packed-web-proof.json'),
      join(verificationRoot, 'staged-web-proof.json'),
    ], { cwd: stagedRoot, env: packedConsumerEnvironment(stagedRoot) })
    if (verificationOutput !== '') console.log(verificationOutput)

    publishStagedDirectory(stagedRoot, output)
    published = true
    console.log(`desktop stage-runtime: staged ${String(packages.length)} production package location(s) at ${output}`)
  } finally {
    removeTreeSafe(workRoot)
    if (!published) removeTreeSafe(stagedRoot)
  }
}

function readTarget(path: string, id: string): RuntimeTarget {
  const config = readJsonObject(path)
  if (config.schemaVersion !== 1 || !Array.isArray(config.targets)) throw new Error(`${path} has unsupported schema`)
  const targets = config.targets as unknown[]
  const value = targets.find(candidate => candidate !== null && typeof candidate === 'object'
    && (candidate as Record<string, unknown>).id === id)
  if (value === undefined) throw new Error(`${path} has no target ${id}`)
  const target = value as Record<string, unknown>
  for (const field of ['id', 'platform', 'arch', 'nodeVersion', 'archiveUrl', 'archiveSha256', 'archiveRoot']) {
    if (typeof target[field] !== 'string' || target[field] === '') throw new Error(`${path} target ${id} lacks ${field}`)
  }
  return target as unknown as RuntimeTarget
}

interface PackedProof {
  readonly target: { readonly platform: string; readonly arch: string; readonly nodeVersion: string; readonly dshVersion: string }
  readonly packages: readonly { readonly name: string; readonly version: string; readonly sha256: string }[]
  readonly clientModules: readonly unknown[]
  readonly frontendAssets: readonly unknown[]
}

function readPackedProof(path: string): PackedProof {
  const proof = readJsonObject(path)
  if (proof.schemaVersion !== 2 || proof.target === null || typeof proof.target !== 'object'
    || !Array.isArray(proof.packages) || !Array.isArray(proof.clientModules) || !Array.isArray(proof.frontendAssets)) {
    throw new Error(`PROOF_INPUT_MISMATCH: ${path} has unsupported fields`)
  }
  return proof as unknown as PackedProof
}

function assertProofInputs(proof: PackedProof, tarballs: readonly { name: string; version: string; sha256: string }[]): void {
  const expected = proof.packages.map(({ name, version, sha256 }) => `${name}@${version}:${sha256}`).sort()
  const actual = tarballs.map(({ name, version, sha256 }) => `${name}@${version}:${sha256}`).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('PROOF_INPUT_MISMATCH: tarball identities differ from the packed Web proof')
  }
}

async function downloadNodeArchive(target: RuntimeTarget, workRoot: string): Promise<string> {
  const response = await fetch(target.archiveUrl, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Node archive download returned HTTP ${String(response.status)}`)
  const path = join(workRoot, `${target.id}.zip`)
  writeFileSync(path, Buffer.from(await response.arrayBuffer()), { flag: 'wx', mode: 0o600 })
  return path
}

function extractNodeArchive(archive: string, target: RuntimeTarget, workRoot: string): string {
  const entries = capture('tar', ['-tf', archive]).split('\n').filter(value => value !== '')
  const prefix = `${target.archiveRoot}/`
  if (entries.length === 0 || entries.some(entry => entry.includes('\\') || entry.startsWith('/')
    || entry.split('/').includes('..') || !(entry === target.archiveRoot || entry.startsWith(prefix)))) {
    throw new Error('NODE_ARCHIVE_INVALID: archive contains an escaping or unexpected path')
  }
  const extractionRoot = join(workRoot, 'node-distribution')
  mkdirSync(extractionRoot, { recursive: true })
  run('tar', ['-xf', archive, '-C', extractionRoot])
  const distribution = join(extractionRoot, target.archiveRoot)
  if (!existsSync(join(distribution, 'node.exe')) || !existsSync(join(distribution, 'LICENSE'))) {
    throw new Error('NODE_ARCHIVE_INVALID: node.exe or LICENSE is absent')
  }
  return distribution
}

function assertNodeTarget(node: string, target: RuntimeTarget): void {
  const expression = 'process.stdout.write(JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch}))'
  const parsed: unknown = JSON.parse(capture(node, ['--eval', expression]))
  if (parsed === null || typeof parsed !== 'object') throw new Error('TARGET_MISMATCH: Node target probe returned no object')
  const actual = parsed as Record<string, unknown>
  if (actual.version !== target.nodeVersion || actual.platform !== target.platform || actual.arch !== target.arch) {
    throw new Error(`TARGET_MISMATCH: expected ${target.nodeVersion} ${target.platform}/${target.arch}`)
  }
}

function assertRuntimeLock(path: string, actual: RuntimeLock): void {
  if (!existsSync(path)) throw new Error(`LOCK_DRIFT: ${path} is absent; run desktop:update-runtime-lock`)
  const expected = readJsonObject(path)
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`LOCK_DRIFT: ${path} differs; review and run desktop:update-runtime-lock`)
  }
}

function createTextHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

if (isEntry(import.meta.url)) await main()

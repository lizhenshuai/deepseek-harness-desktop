/** Checkout-free verifier rejects any staged byte not sealed by the manifest. */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTreeSafe } from './staged-runtime.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) removeTreeSafe(root)
})

describe('staged runtime standalone verifier', () => {
  it('fails before startup when a manifest-sealed file is modified', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-staged-verifier-test-'))
    roots.push(root)
    const runtime = join(root, 'runtime')
    mkdirSync(runtime)
    const file = join(runtime, 'payload.js')
    writeFileSync(file, 'original\n')
    writeFileSync(join(runtime, 'runtime-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      target: { platform: process.platform, arch: process.arch, nodeVersion: process.versions.node, dshVersion: 'test' },
      entrypoint: { script: 'payload.js' },
      packages: [],
      executables: [],
      files: [{
        path: 'payload.js',
        bytes: 9,
        sha256: createHash('sha256').update('original\n').digest('hex'),
      }],
    })}\n`)
    writeFileSync(join(root, 'proof.json'), '{}\n')
    writeFileSync(file, 'tampered\n')

    const result = spawnSync(process.execPath, [
      resolve('scripts/desktop/verify-staged-runtime.mjs'), runtime, join(root, 'proof.json'),
    ], { encoding: 'utf8' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('MANIFEST_MISMATCH')
  })
})

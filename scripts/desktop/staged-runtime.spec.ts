/** Desktop runtime closure, projection, policy, and manifest primitives. */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildRuntimeLock, inventoryRuntime, projectRuntimePackages, removeTreeSafe,
  resolveProductionClosure, verifyRuntimePolicy, type RuntimePackage,
} from './staged-runtime.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) removeTreeSafe(root)
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-staged-runtime-test-'))
  roots.push(root)
  return root
}

function writePackage(root: string, relativePath: string, manifest: Record<string, unknown>): string {
  const directory = join(root, relativePath)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest)}\n`)
  writeFileSync(join(directory, 'index.js'), 'export const value = 1\n')
  return directory
}

describe('desktop runtime closure', () => {
  it('follows production, installed optional, and required peer packages without admitting unrelated packages', () => {
    const root = temporaryRoot()
    writePackage(root, 'node_modules/root', {
      name: 'root', version: '1.0.0', dependencies: { dependency: '1' },
      optionalDependencies: { optional: '1', absent: '1' },
      peerDependencies: { peer: '1', optionalPeer: '1' },
      peerDependenciesMeta: { optionalPeer: { optional: true } },
    })
    writePackage(root, 'node_modules/dependency', { name: 'dependency', version: '1.0.0' })
    writePackage(root, 'node_modules/optional', { name: 'optional', version: '1.0.0' })
    writePackage(root, 'node_modules/peer', { name: 'peer', version: '1.0.0' })
    writePackage(root, 'node_modules/unrelated', { name: 'unrelated', version: '1.0.0' })

    expect(resolveProductionClosure(root, 'root').map(entry => entry.name))
      .toEqual(['dependency', 'optional', 'peer', 'root'])
  })

  it('fails when a required package cannot resolve', () => {
    const root = temporaryRoot()
    writePackage(root, 'node_modules/root', { name: 'root', version: '1.0.0', dependencies: { missing: '1' } })
    expect(() => resolveProductionClosure(root, 'root')).toThrow('CLOSURE_UNRESOLVED')
  })

  it('locks packed bytes and registry integrity at their installed paths', () => {
    const root = temporaryRoot()
    const packedDirectory = writePackage(root, 'node_modules/packed', { name: 'packed', version: '1.0.0' })
    const registryDirectory = writePackage(root, 'node_modules/registry', { name: 'registry', version: '2.0.0' })
    writeFileSync(join(root, 'node_modules', '.package-lock.json'), `${JSON.stringify({
      packages: { 'node_modules/registry': { integrity: 'sha512-registry' } },
    })}\n`)
    const packages: RuntimePackage[] = [
      { path: 'node_modules/packed', directory: packedDirectory, name: 'packed', version: '1.0.0', manifest: {} },
      { path: 'node_modules/registry', directory: registryDirectory, name: 'registry', version: '2.0.0', manifest: {} },
    ]
    expect(buildRuntimeLock('windows-x64', '11.0.0', root, packages, [{
      name: 'packed', version: '1.0.0', path: 'packed.tgz', url: 'file:packed.tgz', sha256: 'packed-sha',
    }])).toEqual({
      schemaVersion: 1,
      target: 'windows-x64',
      npmVersion: '11.0.0',
      packages: [
        { path: 'node_modules/packed', name: 'packed', version: '1.0.0', source: 'packed', sha256: 'packed-sha' },
        { path: 'node_modules/registry', name: 'registry', version: '2.0.0', source: 'registry', integrity: 'sha512-registry' },
      ],
    })
  })
})

describe('desktop runtime projection', () => {
  it('copies runtime files while excluding nested installs, TypeScript, maps, tests, and ordinary Markdown', () => {
    const root = temporaryRoot()
    const source = writePackage(root, 'consumer/node_modules/package', { name: 'package', version: '1.0.0' })
    writeFileSync(join(source, 'source.ts'), 'export {}\n')
    writeFileSync(join(source, 'index.js.map'), '{}\n')
    writeFileSync(join(source, 'README.md'), '# package\n')
    writeFileSync(join(source, 'LICENSE'), 'MIT\n')
    mkdirSync(join(source, 'tests'), { recursive: true })
    writeFileSync(join(source, 'tests', 'fixture.js'), 'throw new Error()\n')
    mkdirSync(join(source, 'node_modules', 'nested'), { recursive: true })
    writeFileSync(join(source, 'node_modules', 'nested', 'index.js'), 'unreachable\n')
    mkdirSync(join(source, 'prebuilds', 'darwin-x64'), { recursive: true })
    writeFileSync(join(source, 'prebuilds', 'darwin-x64', 'addon.node'), 'wrong platform\n')
    mkdirSync(join(source, 'prebuilds', 'win32-x64'), { recursive: true })
    writeFileSync(join(source, 'prebuilds', 'win32-x64', 'addon.node'), 'target platform\n')
    const output = join(root, 'output')
    projectRuntimePackages([{
      path: 'node_modules/package', directory: source, name: 'package', version: '1.0.0', manifest: {},
    }], join(root, 'consumer'), output)

    const projected = join(output, 'node_modules', 'package')
    expect(readFileSync(join(projected, 'index.js'), 'utf8')).toContain('value')
    expect(readFileSync(join(projected, 'LICENSE'), 'utf8')).toBe('MIT\n')
    expect(() => readFileSync(join(projected, 'source.ts'))).toThrow()
    expect(() => readFileSync(join(projected, 'README.md'))).toThrow()
    expect(() => readFileSync(join(projected, 'node_modules', 'nested', 'index.js'))).toThrow()
    expect(() => readFileSync(join(projected, 'prebuilds', 'darwin-x64', 'addon.node'))).toThrow()
    expect(readFileSync(join(projected, 'prebuilds', 'win32-x64', 'addon.node'), 'utf8')).toBe('target platform\n')
  })

  it('rejects credential material and checkout paths', () => {
    const root = temporaryRoot()
    const runtime = join(root, 'runtime')
    mkdirSync(runtime)
    writeFileSync(join(runtime, 'safe.js'), `export const path = ${JSON.stringify(root)}\n`)
    expect(() => { verifyRuntimePolicy(runtime, [root]) }).toThrow('REPOSITORY_PATH_FOUND')
    writeFileSync(join(runtime, 'safe.js'), 'export const value = 1\n')
    writeFileSync(join(runtime, '.env'), 'VALUE=x\n')
    expect(() => { verifyRuntimePolicy(runtime, []) }).toThrow('FORBIDDEN_FILE')
  })

  it('produces a stable sorted file and executable inventory', () => {
    const root = temporaryRoot()
    writeFileSync(join(root, 'z.node'), 'native\n')
    writeFileSync(join(root, 'a.js'), 'script\n')
    expect(inventoryRuntime(root)).toEqual({
      files: [
        { path: 'a.js', bytes: 7, sha256: '5708c28ed70f5aeb31081a46b1ff4b62f772a424563ab73c1132ca08a38ca4e7' },
        { path: 'z.node', bytes: 7, sha256: 'c54b6fd77bc699a17876ed9b46dcf770b66d0bd01380e25cd620ec82adf9c736' },
      ],
      executables: ['z.node'],
    })
  })
})

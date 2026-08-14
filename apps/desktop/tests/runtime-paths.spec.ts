import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDesktopRuntimeRoot } from '../src/runtime-paths.ts'

const roots: string[] = []

function runtimeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-paths-'))
  roots.push(root)
  mkdirSync(join(root, 'node'), { recursive: true })
  mkdirSync(join(root, 'app'), { recursive: true })
  writeFileSync(join(root, 'runtime-manifest.json'), '{}\n')
  writeFileSync(join(root, 'node/node.exe'), 'node\n')
  writeFileSync(join(root, 'app/package.json'), '{}\n')
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop runtime paths', () => {
  it('accepts only an explicit absolute development runtime', () => {
    const root = runtimeFixture()
    expect(resolveDesktopRuntimeRoot({ isPackaged: false, resourcesPath: 'unused', stagedRuntimeRoot: root })).toBe(root)
    expect(isAbsolute(root)).toBe(true)
    expect(() => resolveDesktopRuntimeRoot({ isPackaged: false, resourcesPath: 'unused' })).toThrow(/explicit absolute/)
    expect(() => resolveDesktopRuntimeRoot({ isPackaged: false, resourcesPath: 'unused', stagedRuntimeRoot: 'relative' })).toThrow(/explicit absolute/)
  })

  it('uses resourcesPath and rejects packaged overrides', () => {
    const resources = mkdtempSync(join(tmpdir(), 'dsh-desktop-resources-'))
    roots.push(resources)
    const runtime = join(resources, 'runtime')
    mkdirSync(join(runtime, 'node'), { recursive: true })
    mkdirSync(join(runtime, 'app'), { recursive: true })
    writeFileSync(join(runtime, 'runtime-manifest.json'), '{}\n')
    writeFileSync(join(runtime, 'node/node.exe'), 'node\n')
    writeFileSync(join(runtime, 'app/package.json'), '{}\n')
    expect(resolveDesktopRuntimeRoot({ isPackaged: true, resourcesPath: resources })).toBe(runtime)
    expect(() => resolveDesktopRuntimeRoot({
      isPackaged: true,
      resourcesPath: resources,
      stagedRuntimeRoot: runtime,
    })).toThrow(/cannot override/)
  })

  it('fails loud for missing or link-shaped required files', () => {
    const root = runtimeFixture()
    rmSync(join(root, 'node/node.exe'))
    expect(() => resolveDesktopRuntimeRoot({ isPackaged: false, resourcesPath: 'unused', stagedRuntimeRoot: root })).toThrow(/missing node\/node\.exe/)
    writeFileSync(join(root, 'node/node.exe'), 'node\n')
    rmSync(join(root, 'app/package.json'))
    mkdirSync(join(root, 'app/package.json'))
    expect(() => resolveDesktopRuntimeRoot({ isPackaged: false, resourcesPath: 'unused', stagedRuntimeRoot: root })).toThrow(/regular file/)
  })
})

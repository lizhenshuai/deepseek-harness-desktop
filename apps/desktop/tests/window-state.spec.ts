import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadWindowBounds, saveWindowBounds } from '../src/window-state.ts'

const scratch: string[] = []
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('desktop window state', () => {
  it('round-trips normal bounds that intersect a current display', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-window-'))
    scratch.push(root)
    const bounds = { x: 80, y: 60, width: 1280, height: 800 }
    saveWindowBounds(root, bounds)
    expect(loadWindowBounds(root, [{ x: 0, y: 0, width: 1920, height: 1080 }])).toEqual(bounds)
  })

  it('rejects malformed, undersized, and off-screen records', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-window-'))
    scratch.push(root)
    const path = join(root, 'window-state.json')
    writeFileSync(path, '{')
    expect(loadWindowBounds(root, [])).toBeUndefined()
    writeFileSync(path, JSON.stringify({ x: 0, y: 0, width: 400, height: 300 }))
    expect(loadWindowBounds(root, [{ x: 0, y: 0, width: 1920, height: 1080 }])).toBeUndefined()
    writeFileSync(path, JSON.stringify({ x: 3000, y: 0, width: 1280, height: 800 }))
    expect(loadWindowBounds(root, [{ x: 0, y: 0, width: 1920, height: 1080 }])).toBeUndefined()
  })
})

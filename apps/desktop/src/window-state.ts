/** Validated native-window placement persisted below Electron userData. */

import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Rectangle } from 'electron'

/** Read a usable rectangle that intersects at least one current display. */
export function loadWindowBounds(userData: string, displays: readonly Rectangle[]): Rectangle | undefined {
  const path = join(userData, 'window-state.json')
  if (!existsSync(path)) return undefined
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRectangle(value) || value.width < 960 || value.height < 640) return undefined
    return displays.some(display => intersects(value, display)) ? value : undefined
  } catch {
    return undefined
  }
}

/** Atomically replace the persisted normal bounds with owner-only access. */
export function saveWindowBounds(userData: string, bounds: Rectangle): void {
  const path = join(userData, 'window-state.json')
  if (existsSync(path)) {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return
  }
  const temporary = `${path}.${String(process.pid)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(bounds)}\n`, { flag: 'w', mode: 0o600 })
  renameSync(temporary, path)
}

function isRectangle(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(record[key]))
}

function intersects(left: Rectangle, right: Rectangle): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
}

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopDiagnostics } from '../src/diagnostics.ts'

const scratch: string[] = []
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('desktop diagnostics', () => {
  it('redacts secret assignments and rotates one preceding generation', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-log-'))
    scratch.push(root)
    const diagnostics = new DesktopDiagnostics(root)
    diagnostics.beginGeneration()
    diagnostics.append('stderr', 'DEEPSEEK_API_KEY=visible failure')
    expect(readFileSync(diagnostics.currentPath, 'utf8')).toContain('DEEPSEEK_API_KEY=[REDACTED]')
    expect(readFileSync(diagnostics.currentPath, 'utf8')).not.toContain('visible')
    diagnostics.beginGeneration()
    expect(readFileSync(join(diagnostics.directory, 'backend.previous.log'), 'utf8')).toContain('[REDACTED]')
  })

  it('caps a generation file at one MiB', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-log-'))
    scratch.push(root)
    const diagnostics = new DesktopDiagnostics(root)
    diagnostics.beginGeneration()
    for (let index = 0; index < 80; index += 1) diagnostics.append('stdout', 'x'.repeat(16 * 1024))
    expect(diagnostics.existingBytes()).toBe(1024 * 1024)
  })
})

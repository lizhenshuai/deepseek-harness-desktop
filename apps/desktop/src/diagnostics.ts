/** Bounded, redacted backend diagnostics owned by the desktop main process. */

import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync,
} from 'node:fs'
import { join } from 'node:path'

const FILE_LIMIT = 1024 * 1024
const TAIL_LIMIT = 32 * 1024
const LINE_LIMIT = 16 * 1024
const SECRET = /\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)=([^\s]+)/gi
const BEARER = /\bBearer\s+[^\s]+/gi
const SECRET_QUERY = /([?&](?:api[_-]?key|token|password|secret)=)[^&#\s]+/gi
const URL_CREDENTIALS = /(https?:\/\/)[^/@\s]+@/gi

/** One-generation diagnostic file plus a bounded in-memory tail for recovery dialogs. */
export class DesktopDiagnostics {
  readonly directory: string
  readonly currentPath: string
  private bytes = 0
  private tailText = ''

  /** @param userData - Electron's private per-user application-data directory. */
  constructor(userData: string) {
    this.directory = join(userData, 'logs')
    this.currentPath = join(this.directory, 'backend.log')
  }

  /** Rotate the preceding generation and open a fresh bounded diagnostic stream. */
  beginGeneration(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const previous = join(this.directory, 'backend.previous.log')
    this.removeNonRegular(previous)
    this.removeNonRegular(this.currentPath)
    if (existsSync(previous)) rmSync(previous)
    if (existsSync(this.currentPath)) renameSync(this.currentPath, previous)
    this.bytes = 0
    this.tailText = ''
  }

  /** Append one source-tagged line after redaction and byte caps. */
  append(source: 'desktop' | 'stderr' | 'stdout', value: string): void {
    const normalized = value.replaceAll('\r', '').replaceAll('\0', '�')
    const redacted = normalized
      .replace(SECRET, '$1=[REDACTED]')
      .replace(BEARER, 'Bearer [REDACTED]')
      .replace(SECRET_QUERY, '$1[REDACTED]')
      .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    const clipped = redacted.length > LINE_LIMIT ? `${redacted.slice(0, LINE_LIMIT)}…` : redacted
    const line = `[${source}] ${clipped}\n`
    this.tailText = `${this.tailText}${line}`.slice(-TAIL_LIMIT)
    const data = Buffer.from(line)
    if (this.bytes >= FILE_LIMIT) return
    const writable = data.subarray(0, FILE_LIMIT - this.bytes)
    appendFileSync(this.currentPath, writable, { flag: 'a', mode: 0o600 })
    this.bytes += writable.byteLength
  }

  /** Return the bounded tail safe to include in a native failure dialog. */
  tail(): string {
    return this.tailText
  }

  /** Seed the byte counter when a pre-existing current file is inspected in tests or recovery. */
  existingBytes(): number {
    if (!existsSync(this.currentPath)) return 0
    return readFileSync(this.currentPath).byteLength
  }

  private removeNonRegular(path: string): void {
    if (!existsSync(path)) return
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) rmSync(path)
  }
}

/** Bounded stdin protocol for a parent process that owns this CLI invocation. */

import type { Readable } from 'node:stream'

const SHUTDOWN_FRAME = 'shutdown\n'
const MAX_SUPERVISOR_BYTES = Buffer.byteLength(SHUTDOWN_FRAME)

/** Install one exact-command-or-EOF supervisor and return its listener disposer. */
export function installSupervisedStdin(
  input: Readable,
  interrupt: (code: number) => void,
  report: (message: string) => void,
): () => void {
  let bytes = Buffer.alloc(0)
  let settled = false
  const dispose = (): void => {
    input.off('data', onData)
    input.off('end', onEnd)
    input.off('error', onError)
    input.pause()
  }
  const settle = (code: number, diagnostic?: string): void => {
    if (settled) return
    settled = true
    dispose()
    if (diagnostic !== undefined) report(diagnostic)
    interrupt(code)
  }
  const onData = (chunk: Buffer | string): void => {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes = Buffer.concat([bytes, next])
    if (bytes.byteLength > MAX_SUPERVISOR_BYTES) {
      settle(1, 'dsh: invalid supervised-stdin command')
      return
    }
    if (bytes.includes(0x0a)) {
      settle(bytes.toString('utf8') === SHUTDOWN_FRAME ? 0 : 1,
        bytes.toString('utf8') === SHUTDOWN_FRAME ? undefined : 'dsh: invalid supervised-stdin command')
    }
  }
  const onEnd = (): void => {
    settle(
      bytes.byteLength === 0 ? 0 : 1,
      bytes.byteLength === 0 ? undefined : 'dsh: invalid supervised-stdin command',
    )
  }
  const onError = (): void => { settle(1, 'dsh: supervised stdin failed') }
  input.on('data', onData)
  input.once('end', onEnd)
  input.once('error', onError)
  input.resume()
  return dispose
}

import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { installSupervisedStdin } from '../src/supervised-stdin.ts'

describe('supervised stdin', () => {
  it('accepts one chunked shutdown command once', async () => {
    const input = new PassThrough()
    const interrupt = vi.fn()
    installSupervisedStdin(input, interrupt, vi.fn())
    input.write('shut')
    input.end('down\n')
    await vi.waitFor(() => {
      expect(interrupt).toHaveBeenCalledOnce()
      expect(interrupt).toHaveBeenCalledWith(0)
    })
  })

  it('treats parent EOF as orderly shutdown', async () => {
    const input = new PassThrough()
    const interrupt = vi.fn()
    installSupervisedStdin(input, interrupt, vi.fn())
    input.end()
    await vi.waitFor(() => { expect(interrupt).toHaveBeenCalledWith(0) })
  })

  it.each(['bad\n', 'shutdown\nextra', 'shutdown!'])(
    'rejects malformed or oversized input',
    async (value) => {
      const input = new PassThrough()
      const interrupt = vi.fn()
      const report = vi.fn()
      installSupervisedStdin(input, interrupt, report)
      input.end(value)
      await vi.waitFor(() => {
        expect(interrupt).toHaveBeenCalledWith(1)
        expect(report).toHaveBeenCalledOnce()
      })
    },
  )
})

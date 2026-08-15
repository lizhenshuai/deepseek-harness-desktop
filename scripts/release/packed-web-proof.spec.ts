/** Release-shaped Web proof parsing, isolation, and report primitives. */

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertContainedTarget,
  assertOutsideRepository,
  localAssetsFromIndex,
  parsePackedBootManifest,
  scrubRuntimeEnvironment,
  supportedNodeVersion,
} from './packed-web-proof.ts'

const graph = (entries: unknown[]): string => `<html><head><script>window.__DSH_BOOT__ = ${JSON.stringify({
  rev: 'graph-rev',
  entries,
})}</script></head></html>`

describe('packed Web runtime proof', () => {
  it('scrubs credentials and Node hooks while preserving ordinary Windows startup values', () => {
    expect(scrubRuntimeEnvironment({
      SystemRoot: 'C:\\Windows',
      DEEPSEEK_API_KEY: 'secret',
      ACCESS_TOKEN: 'secret',
      NODE_OPTIONS: '--import=hook',
      NODE_PATH: 'workspace',
      npm_config_user_agent: 'pnpm',
    })).toEqual({ SystemRoot: 'C:\\Windows' })
  })

  it('accepts the repository engine range and rejects unsupported or malformed versions', () => {
    expect(supportedNodeVersion('v22.19.0\n')).toBe('22.19.0')
    expect(supportedNodeVersion('v24.8.0')).toBe('24.8.0')
    expect(() => supportedNodeVersion('v23.9.0')).toThrow('NODE_UNSUPPORTED')
    expect(() => supportedNodeVersion('Node 24')).toThrow('NODE_UNSUPPORTED')
  })

  it('parses, normalizes, and sorts the complete Client graph', () => {
    expect(parsePackedBootManifest(graph([
      { id: 'b', url: '/plugins/b/client.js?rev=2', rev: '2', inject: ['a'] },
      { id: 'a', url: '/plugins/a/client.js?rev=1', rev: '1', immediately: true },
    ]))).toEqual([
      { id: 'a', url: '/plugins/a/client.js?rev=1', rev: '1', inject: [], immediately: true },
      { id: 'b', url: '/plugins/b/client.js?rev=2', rev: '2', inject: ['a'], immediately: false },
    ])
  })

  it('rejects missing manifests, duplicate rows, invalid URLs, and malformed inject lists', () => {
    expect(() => parsePackedBootManifest('<html></html>')).toThrow('BOOT_MANIFEST_MISSING')
    expect(() => parsePackedBootManifest(graph([
      { id: 'a', url: '/plugins/a/client.js?rev=1', rev: '1' },
      { id: 'a', url: '/plugins/a/client.js?rev=1', rev: '1' },
    ]))).toThrow(/duplicate Client package/)
    expect(() => parsePackedBootManifest(graph([
      { id: 'a', url: 'https://example.test/a.js', rev: '1' },
    ]))).toThrow(/invalid URL/)
    expect(() => parsePackedBootManifest(graph([
      { id: 'a', url: '/plugins/a/client.js?rev=1', rev: '1', inject: [42] },
    ]))).toThrow(/invalid inject list/)
  })

  it('preserves inject references supplied by the statically bundled seed', () => {
    expect(parsePackedBootManifest(graph([
      { id: 'a', url: '/plugins/a/client.js?rev=1', rev: '1', inject: ['seed-package'] },
    ]))[0]?.inject).toEqual(['seed-package'])
  })

  it('extracts unique local browser resources without admitting protocol-relative URLs', () => {
    expect(localAssetsFromIndex([
      '<link rel="manifest" href="/manifest.webmanifest">',
      '<link rel="stylesheet" href="/assets/index.css">',
      '<script src="/assets/index.js"></script>',
      '<script src="/assets/index.js"></script>',
      '<script src="//outside.example/x.js"></script>',
    ].join(''))).toEqual(['/assets/index.css', '/assets/index.js', '/manifest.webmanifest'])
  })

  it('rejects consumers inside the repository and package targets outside the consumer', () => {
    const repository = resolve('repository')
    const consumer = resolve('consumer')
    expect(() => { assertOutsideRepository(repository, resolve(repository, 'dist', 'consumer')) })
      .toThrow('WORKSPACE_LINK_FOUND')
    expect(() => { assertOutsideRepository(repository, consumer) }).not.toThrow()
    expect(() => { assertContainedTarget(consumer, resolve(consumer, 'node_modules', 'package'), 'package') })
      .not.toThrow()
    expect(() => { assertContainedTarget(consumer, resolve(repository, 'packages', 'package'), 'package') })
      .toThrow('WORKSPACE_LINK_FOUND')
  })

  it.runIf(process.platform === 'win32')('accepts a consumer on another Windows drive', () => {
    expect(() => { assertOutsideRepository('D:\\source\\repository', 'C:\\temporary\\consumer') }).not.toThrow()
  })
})

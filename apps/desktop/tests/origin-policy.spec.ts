import { describe, expect, it } from 'vitest'
import {
  externalBrowserUrl, isManagedNavigation, parseManagedBackendOrigin,
} from '../src/origin-policy.ts'

describe('desktop origin policy', () => {
  it.each([
    'https://127.0.0.1:3080',
    'http://localhost:3080',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:03080',
    'http://user@127.0.0.1:3080',
    'http://127.0.0.1:3080/path',
    'http://127.0.0.1:3080/?query=1',
    'not a url',
  ])('rejects an unmanaged backend origin: %s', (value) => {
    expect(() => parseManagedBackendOrigin(value)).toThrow(/backend origin/)
  })

  it('canonicalizes the exact loopback origin', () => {
    expect(parseManagedBackendOrigin('http://127.0.0.1:43121')).toEqual({
      origin: 'http://127.0.0.1:43121',
      href: 'http://127.0.0.1:43121/',
    })
    expect(parseManagedBackendOrigin('http://127.0.0.1:43121/').href).toBe('http://127.0.0.1:43121/')
  })

  it('allows only exact-origin frame navigation', () => {
    const managed = parseManagedBackendOrigin('http://127.0.0.1:43121')
    expect(isManagedNavigation('http://127.0.0.1:43121/settings#models', managed)).toBe(true)
    expect(isManagedNavigation('http://127.0.0.1:43122/', managed)).toBe(false)
    expect(isManagedNavigation('https://example.com/', managed)).toBe(false)
    expect(isManagedNavigation('bad url', managed)).toBe(false)
  })

  it('delegates only credential-free external HTTP URLs', () => {
    const managed = parseManagedBackendOrigin('http://127.0.0.1:43121')
    expect(externalBrowserUrl('https://example.com/docs?q=1', managed)).toBe('https://example.com/docs?q=1')
    expect(externalBrowserUrl('http://example.com/', managed)).toBe('http://example.com/')
    for (const rejected of [
      'http://127.0.0.1:43121/inside',
      'https://user:pass@example.com/',
      'file:///C:/secret',
      'javascript:alert(1)',
      'data:text/plain,no',
      'not a url',
    ]) expect(externalBrowserUrl(rejected, managed)).toBeUndefined()
  })
})

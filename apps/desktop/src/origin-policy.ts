import type { ManagedBackendOrigin } from './types.ts'

const MANAGED_ORIGIN = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/

/**
 * Parse the only backend address the desktop shell may load.
 * @param input - Endpoint supplied after backend readiness.
 * @returns Canonical origin and root URL.
 * @throws Error when the endpoint is not an exact loopback HTTP origin.
 */
export function parseManagedBackendOrigin(input: string): ManagedBackendOrigin {
  const match = MANAGED_ORIGIN.exec(input)
  const port = Number(match?.[1])
  if (match === null || port > 65_535) {
    throw new Error(`desktop: backend origin must be http://127.0.0.1:<port>, received ${JSON.stringify(input)}`)
  }
  const parsed = new URL(input)
  return { origin: parsed.origin, href: `${parsed.origin}/` }
}

/**
 * Decide whether a frame or redirect URL stays on the managed backend.
 * @param input - Electron navigation target.
 * @param managed - Validated backend origin.
 * @returns Whether the target has the exact managed origin.
 */
export function isManagedNavigation(input: string, managed: ManagedBackendOrigin): boolean {
  try {
    return new URL(input).origin === managed.origin
  } catch {
    return false
  }
}

/**
 * Select an external URL that may be delegated to the system browser.
 * @param input - Renderer-requested window target.
 * @param managed - Validated backend origin.
 * @returns A canonical HTTP(S) URL, or undefined when delegation is forbidden.
 */
export function externalBrowserUrl(input: string, managed: ManagedBackendOrigin): string | undefined {
  try {
    const parsed = new URL(input)
    if (parsed.origin === managed.origin || !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username !== '' || parsed.password !== '') return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

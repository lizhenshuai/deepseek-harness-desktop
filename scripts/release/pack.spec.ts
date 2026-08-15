import { describe, expect, it } from 'vitest'
import { canonicalizeJson } from './pack.ts'

describe('release pack normalization', () => {
  it('sorts nested object keys without reordering arrays', () => {
    expect(canonicalizeJson({
      z: { second: 2, first: 1 },
      optionalDependencies: { x64: '1', arm64: '1' },
      a: [{ y: 2, x: 1 }, 'tail'],
    })).toEqual({
      a: [{ x: 1, y: 2 }, 'tail'],
      optionalDependencies: { arm64: '1', x64: '1' },
      z: { first: 1, second: 2 },
    })
    expect(Object.keys(canonicalizeJson({ z: 1, a: 2 }) as object)).toEqual(['a', 'z'])
  })
})

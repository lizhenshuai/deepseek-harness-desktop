/**
 * CSS Modules enter client bundles through virtual modules, so the loader must
 * explicitly register the underlying stylesheet as a watch dependency.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clientBundle } from '../packages/client/tsdown.client.ts'

interface CssPlugin {
  name: string
  resolveId?: (source: string, importer?: string) => string | null
  load?: (this: { addWatchFile(id: string): void }, id: string) => Promise<string | null>
}

function cssPlugin(): CssPlugin {
  const configs = clientBundle(
    '@deepseek-ai/dsh-client-test',
    ['lib/types/index.js', 'lib/types/invariant.js'],
  )({ env: { DSH_BUILD_FACE: 'client' } })
  const client = configs.find(config => config.platform === 'browser')
  if (client === undefined) throw new Error('client config missing')
  const plugins = (client as { plugins: CssPlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === 'dsh-css-modules-inline')
  if (plugin === undefined) throw new Error('CSS Modules plugin missing from client config')
  return plugin
}

describe('client bundle CSS Modules', () => {
  it('registers the source stylesheet as a watch dependency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-css-watch-'))
    try {
      const stylesheet = join(root, 'Fixture.module.css')
      const importer = join(root, 'index.ts')
      await writeFile(stylesheet, '.root { color: red; }\n')
      const plugin = cssPlugin()
      const virtualId = plugin.resolveId?.('./Fixture.module.css', importer)
      if (typeof virtualId !== 'string' || plugin.load === undefined) {
        throw new Error('CSS Modules plugin hooks are incomplete')
      }
      expect(virtualId).not.toContain(root)
      const watched: string[] = []

      const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

      expect(watched).toEqual([stylesheet])
      expect(output).toContain('data-plugin-css')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('derives class names from the stable module id rather than the physical root', async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), 'dsh-client-css-first-'))
    const secondRoot = await mkdtemp(join(tmpdir(), 'dsh-client-css-second-'))
    try {
      const load = async (root: string): Promise<string> => {
        const stylesheet = join(root, 'Fixture.module.css')
        await writeFile(stylesheet, '.root { color: red; }\n')
        const plugin = cssPlugin()
        const virtualId = plugin.resolveId?.('./Fixture.module.css', join(root, 'index.ts'))
        if (typeof virtualId !== 'string' || plugin.load === undefined) {
          throw new Error('CSS Modules plugin hooks are incomplete')
        }
        const output = await plugin.load.call({ addWatchFile() {} }, virtualId)
        if (output === null) throw new Error('CSS Modules plugin returned no output')
        return output
      }

      expect(await load(firstRoot)).toBe(await load(secondRoot))
    } finally {
      await Promise.all([
        rm(firstRoot, { recursive: true, force: true }),
        rm(secondRoot, { recursive: true, force: true }),
      ])
    }
  })

  it('serializes class exports in lexical order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-css-exports-'))
    try {
      const stylesheet = join(root, 'Fixture.module.css')
      await writeFile(stylesheet, '.zeta { color: red; }\n.alpha { color: blue; }\n')
      const plugin = cssPlugin()
      const virtualId = plugin.resolveId?.('./Fixture.module.css', join(root, 'index.ts'))
      if (typeof virtualId !== 'string' || plugin.load === undefined) {
        throw new Error('CSS Modules plugin hooks are incomplete')
      }
      const output = await plugin.load.call({ addWatchFile() {} }, virtualId)
      if (output === null) throw new Error('CSS Modules plugin returned no output')
      const serialized = output.match(/export default (\{.*\});/)?.[1]
      if (serialized === undefined) throw new Error('CSS Modules plugin returned no class map')

      expect(Object.keys(JSON.parse(serialized) as Record<string, string>)).toEqual(['alpha', 'zeta'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

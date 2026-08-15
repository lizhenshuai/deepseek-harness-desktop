import { defineConfig } from 'tsdown'

const entry = (path: `lib/types/${'index' | 'invariant' | 'managed-process'}.js`) => ({
  entry: [path],
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024' as const,
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  dts: false,
  clean: false,
})

/** Emit each public entry as a self-contained file admitted by the package whitelist. */
export default defineConfig([
  entry('lib/types/index.js'),
  entry('lib/types/invariant.js'),
  entry('lib/types/managed-process.js'),
])

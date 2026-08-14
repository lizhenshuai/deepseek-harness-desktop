import { defineConfig } from 'tsdown'

/** Build the Electron main-process entry while leaving Electron provided by its executable. */
export default defineConfig({
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  tsconfig: '../../tsconfig.base.json',
  deps: {
    alwaysBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-subprocess',
      '@deepseek-ai/dsh-subprocess-local/**',
      '@deepseek-ai/dsh-timeout',
      'electron-squirrel-startup',
    ],
    neverBundle: ['electron'],
  },
  fixedExtension: false,
  dts: false,
  clean: ['lib/*.js'],
})

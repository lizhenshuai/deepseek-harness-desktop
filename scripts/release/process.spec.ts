/** Shell-free release command resolution across POSIX and Windows hosts. */

import { describe, expect, it } from 'vitest'
import { npmCliForNode } from './packed-consumer.ts'
import { commandInvocation } from './process.ts'

describe('release process command resolution', () => {
  it('keeps ordinary and POSIX commands unchanged', () => {
    expect(commandInvocation('pnpm', ['pack'], 'linux')).toEqual({ command: 'pnpm', args: ['pack'] })
    expect(commandInvocation('git', ['status'], 'win32')).toEqual({ command: 'git', args: ['status'] })
  })

  it('drives pnpm and npm JavaScript entries directly on Windows', () => {
    const exists = (): boolean => true
    expect(commandInvocation('pnpm', ['pack'], 'win32', { npm_execpath: 'D:\\pnpm.cjs' }, 'C:\\node.exe', exists))
      .toEqual({ command: 'C:\\node.exe', args: ['D:\\pnpm.cjs', 'pack'] })
    expect(commandInvocation('npm', ['install'], 'win32', {}, 'C:\\node\\node.exe', exists))
      .toEqual({
        command: 'C:\\node\\node.exe',
        args: ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', 'install'],
      })
  })

  it('fails loud when a Windows package-manager entry is unavailable', () => {
    const missing = (): boolean => false
    expect(() => commandInvocation('pnpm', [], 'win32', {}, 'C:\\node.exe', missing))
      .toThrow(/pnpm JavaScript entry unavailable/)
    expect(() => commandInvocation('npm', [], 'win32', {}, 'C:\\node.exe', missing))
      .toThrow(/npm JavaScript entry unavailable/)
  })
})

describe('npm CLI resolution for official Node distributions', () => {
  it('uses the platform distribution layout', () => {
    expect(npmCliForNode('C:\\node\\node.exe', 'win32'))
      .toBe('C:\\node\\node_modules\\npm\\bin\\npm-cli.js')
    expect(npmCliForNode('/opt/node/bin/node', 'linux'))
      .toBe('/opt/node/lib/node_modules/npm/bin/npm-cli.js')
    expect(npmCliForNode('/opt/node/bin/node', 'darwin'))
      .toBe('/opt/node/lib/node_modules/npm/bin/npm-cli.js')
  })
})

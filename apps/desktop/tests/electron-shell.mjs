/** Real Electron smoke over staged and packaged desktop runtime compositions. */

import { spawn } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import electronPath from 'electron'
import { _electron as electron, chromium } from 'playwright'

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD)/i
const packaged = process.argv[2] === '--packaged'
const runtimeArgument = process.argv[packaged ? 3 : 2]
if (process.platform !== 'win32') throw new Error('desktop Electron smoke requires Windows')
if (runtimeArgument === undefined || !isAbsolute(runtimeArgument)) {
  throw new Error('usage: electron-shell.mjs <absolute-staged-runtime-root> | --packaged <absolute-executable>')
}

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const electronEntry = join(repositoryRoot, 'apps/desktop/lib/main.js')
const executablePath = packaged ? resolve(runtimeArgument) : electronPath
const launchArguments = packaged ? ['--disable-gpu'] : ['--disable-gpu', electronEntry]
const expectedSnapshot = join(import.meta.dirname, `snapshots/electron-shell${packaged ? '-packaged' : ''}.json`)
const visualSnapshot = join(import.meta.dirname, `snapshots/electron-shell${packaged ? '-packaged' : ''}.png`)
const scratch = mkdtempSync(join(tmpdir(), 'dsh-desktop-electron-'))
const userData = join(scratch, 'electron-user-data')
const environment = scrubEnvironment(process.env)
environment.DSH_HOME = join(scratch, 'dsh-home')
environment.DSH_AGENTS_HOME = join(scratch, 'agents-home')
environment.DSH_TELEMETRY_DISABLED = '1'
environment.APPDATA = join(scratch, '应用 数据')
environment.LOCALAPPDATA = join(scratch, '本地 数据')
if (!packaged) {
  environment.DSH_DESKTOP_TEST_USER_DATA = userData
  environment.DSH_DESKTOP_RUNTIME_ROOT = resolve(runtimeArgument)
}

let application
let browser
let packagedProcess
let page
try {
  let context
  if (packaged) {
    const port = await reserveLoopbackPort()
    packagedProcess = spawn(executablePath, [...launchArguments, `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${String(port)}`], {
      env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const endpoint = `http://127.0.0.1:${String(port)}`
    await waitForDevTools(endpoint, packagedProcess)
    browser = await chromium.connectOverCDP(endpoint)
    context = browser.contexts()[0]
    if (context === undefined) throw new Error('packaged desktop exposed no browser context')
    page = await waitForPage(context)
  } else {
    application = await electron.launch({
      executablePath,
      args: launchArguments,
      env: environment,
    })
    page = await application.firstWindow()
  }
  const origin = new URL(page.url()).origin
  await page.waitForFunction(expected => location.origin === expected && document.readyState === 'complete', origin)
  const renderer = await page.evaluate(() => ({
    origin: location.origin,
    requireType: typeof globalThis.require,
    processType: typeof globalThis.process,
    bootEntries: Array.isArray(globalThis.__DSH_BOOT__?.entries) ? globalThis.__DSH_BOOT__.entries.length : 0,
    childWindowDenied: window.open('/settings') === null,
  }))
  const second = spawn(executablePath, launchArguments, { env: environment, windowsHide: true, stdio: 'ignore' })
  const secondExit = await waitForExit(second, 15_000)
  let restartedOrigin
  if (!packaged) {
    const restartedWindow = application.waitForEvent('window')
    await application.evaluate(({ Menu }) => {
      const restart = Menu.getApplicationMenu()?.items
        .flatMap(item => item.submenu?.items ?? [])
        .find(item => item.label === '重启后端')
      if (restart === undefined) throw new Error('desktop restart menu item is missing')
      restart.click(undefined, undefined, undefined)
    })
    page = await restartedWindow
    await page.waitForFunction(previous => location.origin !== previous && document.readyState === 'complete', origin)
    restartedOrigin = new URL(page.url()).origin
  }
  await page.waitForTimeout(1_000)
  const report = {
    schemaVersion: 1,
    windows: windowCount(application, context),
    renderer: {
      originKind: renderer.origin === origin ? 'managed-loopback' : 'unexpected',
      requireType: renderer.requireType,
      processType: renderer.processType,
      bootEntriesPositive: renderer.bootEntries > 0,
      childWindowDenied: renderer.childWindowDenied,
    },
    secondInstance: {
      exited: true,
      exitCode: secondExit,
      windowCountAfterExit: windowCount(application, context),
    },
    ...restartedOrigin === undefined ? {} : {
      restart: {
        originChanged: restartedOrigin !== origin,
        windowCount: windowCount(application, context),
      },
    },
  }
  const rendered = `${JSON.stringify(report, undefined, 2)}\n`
  const screenshot = await page.screenshot()
  if (process.env.DSH_DESKTOP_SNAPSHOT === 'record') {
    mkdirSync(join(import.meta.dirname, 'snapshots'), { recursive: true })
    writeFileSync(expectedSnapshot, rendered)
    writeFileSync(visualSnapshot, screenshot)
  } else {
    const expected = readFileSync(expectedSnapshot, 'utf8')
    if (rendered !== expected) throw new Error(`desktop Electron snapshot mismatch:\n${rendered}`)
    const expectedScreenshot = readFileSync(visualSnapshot)
    if (!screenshot.equals(expectedScreenshot)) throw new Error('desktop Electron visual snapshot mismatch')
  }
  const evidencePath = process.env.DSH_DESKTOP_SCREENSHOT
  if (evidencePath !== undefined) writeFileSync(resolve(evidencePath), screenshot)
  console.log(`desktop electron smoke (${packaged ? 'packaged' : 'development'}): ${String(report.windows)} window, ${String(renderer.bootEntries)} Client entries, secondary exit ${String(secondExit)}`)
} finally {
  if (application !== undefined) await application.close()
  if (page !== undefined && !page.isClosed()) await page.close().catch(() => undefined)
  if (browser !== undefined) await browser.close().catch(() => undefined)
  if (packagedProcess !== undefined && packagedProcess.exitCode === null) {
    await waitForExit(packagedProcess, 15_000).catch(() => undefined)
  }
  removeTreeSafe(scratch)
}

function windowCount(application, context) {
  return application === undefined ? context.pages().length : application.windows().length
}

async function reserveLoopbackPort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('failed to reserve a desktop debugging port')
  await new Promise((resolveClose, rejectClose) => server.close(error => error === undefined ? resolveClose() : rejectClose(error)))
  return address.port
}

async function waitForDevTools(endpoint, child) {
  const deadline = Date.now() + 120_000
  let stderr = ''
  child.stderr?.on('data', chunk => { stderr = `${stderr}${chunk.toString()}`.slice(-32 * 1024) })
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`packaged desktop exited before DevTools readiness (${String(child.exitCode)}):\n${stderr}`)
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch (_notReady) {
      // The loopback endpoint is absent until Chromium has initialized.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  throw new Error(`packaged desktop DevTools endpoint did not become ready:\n${stderr}`)
}

async function waitForPage(context) {
  const existing = context.pages()[0]
  return existing ?? context.waitForEvent('page', { timeout: 120_000 })
}

function scrubEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !SECRET_NAME.test(name)
    && !['NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_USER_AGENT'].includes(name.toUpperCase())))
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolveExit, rejectExit) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    timer.unref()
    child.once('error', error => { clearTimeout(timer); rejectExit(error) })
    child.once('exit', code => {
      clearTimeout(timer)
      if (timedOut) rejectExit(new Error('desktop secondary instance did not exit'))
      else resolveExit(code)
    })
  })
}

function removeTreeSafe(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    unlinkSync(path)
    return
  }
  for (const entry of readdirSync(path)) removeTreeSafe(join(path, entry))
  rmdirSync(path)
}

/** CDP-only installed-application probe executed by the candidate's bundled Node. */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const argumentsByName = parseArguments(process.argv.slice(2))
const executable = resolve(required(argumentsByName, 'exe'))
const output = resolve(required(argumentsByName, 'out'))
const screenshot = resolve(required(argumentsByName, 'screenshot'))
const canary = `dsh-acceptance-${Date.now().toString(36)}`
const first = await launchAndProbe(executable, { writeCanary: canary, screenshot })
const second = await launchAndProbe(executable, { expectedCanary: canary })
writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, first, second }, undefined, 2)}\n`)

async function launchAndProbe(executablePath, options) {
  const port = await reserveLoopbackPort()
  const environment = scrubEnvironment(process.env)
  environment.HTTP_PROXY = 'http://127.0.0.1:9'
  environment.HTTPS_PROXY = 'http://127.0.0.1:9'
  environment.NO_PROXY = '127.0.0.1,localhost'
  environment.DSH_TELEMETRY_DISABLED = '1'
  const child = spawn(executablePath, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${String(port)}`,
  ], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk.toString()}`.slice(-32 * 1024) })
  const endpoint = `http://127.0.0.1:${String(port)}`
  const target = await waitForTarget(endpoint, child, () => stderr)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  try {
    await cdp.send('Runtime.enable')
    await waitForExpression(cdp, "location.hostname === '127.0.0.1' && document.readyState === 'complete'")
    await evaluate(cdp, `(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const button = dialog === null ? undefined : [...dialog.querySelectorAll('button')]
        .find(candidate => candidate.textContent?.includes('继续'))
      button?.click()
    })()`)
    await delay(500)
    const facts = await evaluate(cdp, `(() => {
      const key = 'dsh.desktop.acceptance.canary'
      ${options.writeCanary === undefined ? '' : `localStorage.setItem(key, ${JSON.stringify(options.writeCanary)})`}
      return {
        origin: location.origin,
        requireType: typeof globalThis.require,
        processType: typeof globalThis.process,
        clientEntries: Array.isArray(globalThis.__DSH_BOOT__?.entries) ? globalThis.__DSH_BOOT__.entries.length : 0,
        childWindowDenied: window.open('/settings') === null,
        missingCredentialVisible: document.body.innerText.includes('API Key') || document.body.innerText.includes('API 密钥'),
        canary: localStorage.getItem(key),
      }
    })()`)
    if (options.expectedCanary !== undefined && facts.canary !== options.expectedCanary) {
      throw new Error('installed desktop did not preserve its renderer canary')
    }
    if (options.screenshot !== undefined) {
      const captured = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(options.screenshot, Buffer.from(captured.data, 'base64'))
    }
    await cdp.send('Browser.close').catch(() => undefined)
    await waitForExit(child, 30_000)
    return facts
  } finally {
    cdp.close()
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

function parseArguments(argv) {
  const result = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith('--') || value === undefined) throw new Error('probe arguments must be --name value pairs')
    result.set(flag.slice(2), value)
  }
  return result
}

function required(values, name) {
  const value = values.get(name)
  if (value === undefined) throw new Error(`installed desktop probe requires --${name}`)
  return value
}

function scrubEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !/(KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)
    && !['NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_USER_AGENT'].includes(name.toUpperCase())))
}

async function reserveLoopbackPort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('installed desktop probe could not reserve a loopback port')
  await new Promise((resolveClose, rejectClose) => server.close(error => error === undefined ? resolveClose() : rejectClose(error)))
  return address.port
}

async function waitForTarget(endpoint, child, stderr) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`installed desktop exited before readiness (${String(child.exitCode)}): ${stderr()}`)
    try {
      const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(target => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
        if (page !== undefined) return page
      }
    } catch (_notReady) {
      // Chromium does not publish its target list until the application window exists.
    }
    await delay(100)
  }
  throw new Error(`installed desktop did not expose a page target: ${stderr()}`)
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', () => rejectOpen(new Error('CDP websocket failed to open')), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (typeof message.id !== 'number') return
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    if (message.error === undefined) waiter.resolve(message.result ?? {})
    else waiter.reject(new Error(`CDP ${waiter.method} failed: ${message.error.message}`))
  })
  return {
    send(method, params = {}) {
      const id = ++nextId
      return new Promise((resolveResult, rejectResult) => {
        pending.set(id, { method, resolve: resolveResult, reject: rejectResult })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { socket.close() },
  }
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails !== undefined) throw new Error('installed desktop expression failed')
  return response.result.value
}

async function waitForExpression(cdp, expression) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return
    await delay(100)
  }
  throw new Error(`installed desktop expression timed out: ${expression}`)
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error('installed desktop did not exit after Browser.close')), timeoutMs)
    child.once('exit', (code) => { clearTimeout(timer); resolveExit(code) })
    child.once('error', (error) => { clearTimeout(timer); rejectExit(error) })
  })
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

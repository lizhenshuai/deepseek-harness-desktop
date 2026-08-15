/** Plain-Node verifier shipped beside a staged desktop runtime for checkout-free CI. */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync,
  unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const READY_PATTERN = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/
const BOOT_PATTERN = /<script>window\.__DSH_BOOT__ = (.*?)<\/script>/s
const LOCAL_ASSET_PATTERN = /<(?:script|link)\b[^>]*(?:src|href)="(\/[^"#]+)"/g
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD)/i
const OUTPUT_LIMIT = 32 * 1024

const [runtimeArgument, proofArgument, reportArgument] = process.argv.slice(2)
if (runtimeArgument === undefined || proofArgument === undefined) {
  throw new Error('usage: verify-staged-runtime.mjs <runtime> <expected-packed-proof> [report]')
}
const runtimeRoot = resolve(runtimeArgument)
const expectedProof = JSON.parse(readFileSync(resolve(proofArgument), 'utf8'))
const manifestPath = join(runtimeRoot, 'runtime-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
verifyManifest(runtimeRoot, manifest)
if (process.platform !== manifest.target.platform || process.arch !== manifest.target.arch
  || process.versions.node !== manifest.target.nodeVersion) {
  throw new Error(`TARGET_MISMATCH: expected Node ${manifest.target.nodeVersion} ${manifest.target.platform}/${manifest.target.arch}`)
}

const entry = join(runtimeRoot, ...manifest.entrypoint.script.split('/'))
const environment = scrubEnvironment(process.env)
const home = mkdtempSync(join(tmpdir(), 'dsh-staged-proof-'))
environment.DSH_HOME = join(home, 'home')
environment.DSH_AGENTS_HOME = join(home, 'agents')
environment.DSH_TELEMETRY_DISABLED = '1'
try {
  const version = spawnSync(process.execPath, [entry, '--version'], {
    cwd: runtimeRoot,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (version.error !== undefined) throw version.error
  if (version.status !== 0 || version.stdout.trim() !== manifest.target.dshVersion) {
    throw new Error(`STAGED_SMOKE_FAILED: dsh --version returned ${JSON.stringify(version.stdout.trim())}`)
  }

  const child = spawn(process.execPath, [entry, 'web', '--host', '127.0.0.1', '--port', '0'], {
    cwd: runtimeRoot,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const append = chunk => { output = `${output}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  try {
    const baseUrl = await waitForReady(child, () => output)
    const index = await fetchText(`${baseUrl}/`, 'frontend index')
    const clientModules = parseBootManifest(index)
    const urls = [
      ...localAssets(index),
      ...clientModules.map(row => row.url),
    ].filter((url, index, all) => all.indexOf(url) === index).sort()
    const frontendAssets = []
    for (const url of urls) {
      const body = await fetchBytes(baseUrl + url, url)
      frontendAssets.push({
        url,
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      })
    }
    if (JSON.stringify(clientModules) !== JSON.stringify(expectedProof.clientModules)) {
      throw new Error('STAGED_SMOKE_FAILED: staged Client graph differs from the packed proof')
    }
    if (JSON.stringify(frontendAssets) !== JSON.stringify(expectedProof.frontendAssets)) {
      throw new Error('STAGED_SMOKE_FAILED: staged browser resources differ from the packed proof')
    }
    verifyProfileLinks(runtimeRoot, join(environment.DSH_HOME, 'profiles', 'node_modules'))
    const report = {
      schemaVersion: 1,
      target: manifest.target,
      runtimeManifestSha256: sha256File(manifestPath),
      clientModules,
      frontendAssets,
      checks: {
        manifestMatches: true,
        profileLinksContained: true,
        webReady: true,
        packedProofMatches: true,
        credentialsAbsent: true,
      },
    }
    if (reportArgument !== undefined) writeFileSync(resolve(reportArgument), `${JSON.stringify(report, undefined, 2)}\n`)
    console.log(`desktop verify-staged-runtime: ${String(manifest.packages.length)} package location(s), ${String(clientModules.length)} Client bundle(s), ${String(frontendAssets.length)} browser resource(s)`)
  } finally {
    await stopChild(child)
  }
} finally {
  removeTreeSafe(home)
}

function verifyManifest(root, value) {
  if (value.schemaVersion !== 1 || !Array.isArray(value.files) || !Array.isArray(value.executables)) {
    throw new Error('MANIFEST_MISMATCH: unsupported runtime manifest')
  }
  const actual = walkFiles(root)
    .map(path => normalizePath(relative(root, path)))
    .filter(path => path !== 'runtime-manifest.json')
    .sort()
    .map(path => ({ path, bytes: statSync(join(root, path)).size, sha256: sha256File(join(root, path)) }))
  if (JSON.stringify(actual) !== JSON.stringify(value.files)) {
    throw new Error('MANIFEST_MISMATCH: staged runtime files differ from runtime-manifest.json')
  }
}

function parseBootManifest(html) {
  const match = BOOT_PATTERN.exec(html)
  if (match?.[1] === undefined) throw new Error('STAGED_SMOKE_FAILED: served index has no boot manifest')
  const parsed = JSON.parse(match[1])
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) throw new Error('STAGED_SMOKE_FAILED: boot manifest has no entries')
  const ids = new Set()
  return parsed.entries.map(value => {
    if (typeof value?.id !== 'string' || typeof value.url !== 'string' || typeof value.rev !== 'string') {
      throw new Error('STAGED_SMOKE_FAILED: boot entry has invalid fields')
    }
    if (ids.has(value.id) || value.url !== `/plugins/${value.id}/client.js?rev=${value.rev}`) {
      throw new Error(`STAGED_SMOKE_FAILED: invalid Client entry ${value.id}`)
    }
    ids.add(value.id)
    if (value.inject !== undefined && (!Array.isArray(value.inject) || value.inject.some(item => typeof item !== 'string'))) {
      throw new Error(`STAGED_SMOKE_FAILED: invalid inject list for ${value.id}`)
    }
    return {
      id: value.id,
      url: value.url,
      rev: value.rev,
      inject: value.inject === undefined ? [] : [...value.inject].sort(),
      immediately: value.immediately === true,
    }
  }).sort((left, right) => left.id.localeCompare(right.id))
}

function localAssets(html) {
  return [...html.matchAll(LOCAL_ASSET_PATTERN)]
    .flatMap(match => match[1] === undefined ? [] : [match[1]])
    .filter(url => !url.startsWith('//'))
    .filter((url, index, all) => all.indexOf(url) === index)
    .sort()
}

function verifyProfileLinks(runtime, profilesModules) {
  const allowed = realpathSync(runtime)
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path)
        if (!contained(allowed, target)) throw new Error(`LINK_ESCAPE: profile module ${entry.name} leaves the staged runtime`)
      } else if (stat.isDirectory()) visit(path)
    }
  }
  visit(profilesModules)
}

function scrubEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !SECRET_NAME.test(name)
    && !['NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_USER_AGENT'].includes(name.toUpperCase())))
}

async function fetchText(url, subject) {
  return (await fetchResponse(url, subject)).text()
}

async function fetchBytes(url, subject) {
  return Buffer.from(await (await fetchResponse(url, subject)).arrayBuffer())
}

async function fetchResponse(url, subject) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`STAGED_SMOKE_FAILED: ${subject} returned HTTP ${String(response.status)}`)
  return response
}

function waitForReady(child, output) {
  return new Promise((resolveReady, rejectReady) => {
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout.off('data', inspect)
      child.stderr.off('data', inspect)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const inspect = () => {
      const match = READY_PATTERN.exec(output())
      if (match?.[1] === undefined) return
      cleanup()
      resolveReady(match[1])
    }
    const onError = error => {
      cleanup()
      rejectReady(error)
    }
    const onExit = code => {
      cleanup()
      rejectReady(new Error(`STAGED_SMOKE_FAILED: dsh web exited with ${String(code)} before readiness:\n${output()}`))
    }
    const timer = setTimeout(() => {
      cleanup()
      rejectReady(new Error(`STAGED_SMOKE_FAILED: dsh web readiness timed out:\n${output()}`))
    }, 60_000)
    timer.unref()
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', onError)
    child.once('exit', onExit)
    inspect()
  })
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', resolveExit)
  })
}

async function stopChild(child) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = childExit(child)
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise(resolveTimeout => {
      const timer = setTimeout(() => resolveTimeout(false), 10_000)
      timer.unref()
    }),
  ])
  if (!stopped) {
    child.kill('SIGKILL')
    await exited
  }
}

function walkFiles(root) {
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new Error(`LINK_ESCAPE: ${path} is a link or junction`)
      if (stat.isDirectory()) visit(path)
      else if (stat.isFile()) files.push(path)
    }
  }
  visit(root)
  return files
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

function contained(root, target) {
  const fromRoot = relative(resolve(root), resolve(target))
  return fromRoot === '' || (!isAbsolute(fromRoot) && !fromRoot.startsWith(`..${sep}`) && fromRoot !== '..')
}

function normalizePath(path) {
  return path.replaceAll('\\', '/')
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { arch, homedir, platform, release, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { _electron as electron, chromium } from 'playwright'
import { createServer } from 'vite'

import {
  DESKTOP_VISUAL_SCENARIOS,
  DESKTOP_VISUAL_VIEWPORTS,
} from './desktop-visual-scenarios.mjs'
import { createDesktopVisualSnapshot } from './fixtures/desktop-visual-seed.mjs'

const require = createRequire(import.meta.url)
const REPORT_SCHEMA_VERSION = 1
const SNAPSHOT_SCHEMA_VERSION = 11
const DEFAULT_OUTPUT_ROOT = resolve('.gstack/qa-reports/desktop-visual-convergence')

function isSameOrDescendant(target, root) {
  const delta = relative(resolve(root), resolve(target))
  return delta === '' || (delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta))
}

export function assertSafeElectronIsolationPaths({
  userDataPath,
  libraryPath,
  temporaryRoot,
  realApplicationDataRoots,
}) {
  for (const [label, value] of [
    ['userDataPath', userDataPath],
    ['libraryPath', libraryPath],
    ['temporaryRoot', temporaryRoot],
  ]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  }
  for (const [label, value] of [
    ['userDataPath', userDataPath],
    ['libraryPath', libraryPath],
  ]) {
    if (!isSameOrDescendant(value, temporaryRoot) || resolve(value) === resolve(temporaryRoot)) {
      throw new Error(`${label} must be a child of the temporary root`)
    }
    for (const root of realApplicationDataRoots) {
      if (isSameOrDescendant(value, root)) {
        throw new Error(`${label} resolves inside real application data: ${root}`)
      }
    }
  }
}

function realApplicationDataRoots(packageJson) {
  const names = new Set([packageJson.build?.productName, packageJson.name].filter(Boolean))
  const parentRoots = [
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    join(homedir(), 'Library', 'Application Support'),
  ].filter(Boolean)
  return [...new Set(parentRoots.flatMap((parent) => [...names].map((name) => resolve(parent, name))))]
}

function sourceBuild(root, packageJson) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const status = git(['status', '--porcelain=v1'])
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: status.length > 0,
    status: status ? status.split(/\r?\n/) : [],
    packageVersion: packageJson.version,
  }
}

function ensureRuntimeOutput(outputRoot, runtime) {
  const root = resolve(outputRoot)
  const runtimeRoot = resolve(root, runtime)
  if (!isSameOrDescendant(runtimeRoot, root) || runtimeRoot === root) {
    throw new Error(`Unsafe desktop visual output path: ${runtimeRoot}`)
  }
  rmSync(runtimeRoot, { recursive: true, force: true })
  mkdirSync(runtimeRoot, { recursive: true })
  return { root, runtimeRoot }
}

async function seedBrowserDatabase(page, snapshot) {
  await page.evaluate(async ({ payload, schemaVersion }) => {
    await new Promise((resolveDelete) => {
      const request = indexedDB.deleteDatabase('trader-atlas-v3')
      request.onsuccess = resolveDelete
      request.onerror = resolveDelete
      request.onblocked = resolveDelete
    })
    const database = await new Promise((resolveDatabase, reject) => {
      const request = indexedDB.open('trader-atlas-v3', 1)
      request.onupgradeneeded = () => {
        const next = request.result
        if (!next.objectStoreNames.contains('snapshot')) next.createObjectStore('snapshot')
        if (!next.objectStoreNames.contains('assets')) next.createObjectStore('assets', { keyPath: 'id' })
        if (!next.objectStoreNames.contains('meta')) next.createObjectStore('meta')
      }
      request.onsuccess = () => resolveDatabase(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolveWrite, reject) => {
      const transaction = database.transaction(['snapshot', 'meta'], 'readwrite')
      transaction.objectStore('snapshot').put(payload, 'main')
      transaction.objectStore('meta').put({
        schemaVersion,
        libraryId: 'desktop-visual-isolated',
        createdAt: '2026-08-12T00:00:00.000Z',
        platform: 'web',
      }, 'manifest')
      transaction.objectStore('meta').put(0, 'snapshotRevision')
      transaction.oncomplete = resolveWrite
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  }, { payload: snapshot, schemaVersion: SNAPSHOT_SCHEMA_VERSION })
}

async function waitForVisualSettlement(page, readySelector) {
  await page.locator(readySelector).waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.documentElement.dataset.uiSettled === '1', null, {
    timeout: 30_000,
  })
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))
  })
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < innerHeight && rect.left < innerWidth
    }
    const rect = (element) => {
      if (!(element instanceof HTMLElement)) return null
      const bounds = element.getBoundingClientRect()
      return {
        x: Math.round(bounds.x * 100) / 100,
        y: Math.round(bounds.y * 100) / 100,
        width: Math.round(bounds.width * 100) / 100,
        height: Math.round(bounds.height * 100) / 100,
      }
    }
    const primaryActions = [...document.querySelectorAll('.ui-btn-primary')]
      .filter(visible)
      .map((element) => ({
        label: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        disabled: element.matches(':disabled,[aria-disabled="true"]'),
        bounds: rect(element),
      }))
    const documentScrollWidth = document.documentElement.scrollWidth
    const documentClientWidth = document.documentElement.clientWidth
    return {
      documentScrollWidth,
      documentClientWidth,
      horizontalOverflowPx: Math.max(0, documentScrollWidth - documentClientWidth),
      documentScrollHeight: document.documentElement.scrollHeight,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      mainBounds: rect(document.querySelector('#main-content')),
      visiblePrimaryActionCount: primaryActions.length,
      primaryActions,
      visibleTextCharacters: document.body.innerText.replace(/\s+/g, '').length,
    }
  })
}

function capturePath(runtimeRoot, viewport, scenario) {
  const directory = join(runtimeRoot, `${viewport.width}x${viewport.height}`)
  mkdirSync(directory, { recursive: true })
  return join(directory, `${scenario.id}.png`)
}

async function captureScenario({
  page,
  runtime,
  viewport,
  scenario,
  screenshot,
  build,
  navigate,
  diagnostics,
}) {
  diagnostics.console.length = 0
  diagnostics.page.length = 0
  await navigate(scenario.path)
  await waitForVisualSettlement(page, scenario.ready)
  const metrics = await collectMetrics(page)
  await page.screenshot({ path: screenshot, fullPage: false, animations: 'disabled' })
  return {
    build,
    runtime,
    viewport,
    scenario,
    screenshot,
    consoleErrors: [...diagnostics.console],
    pageErrors: [...diagnostics.page],
    metrics,
  }
}

function bindDiagnostics(page) {
  const diagnostics = { console: [], page: [] }
  page.on('pageerror', (error) => diagnostics.page.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (message.text().includes('React Router Future Flag')) return
    diagnostics.console.push(message.text())
  })
  return diagnostics
}

async function runRendererQa({ root, runtimeRoot, build, snapshot }) {
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      open: false,
      fs: { allow: [root] },
    },
  })
  let browser
  const captures = []
  try {
    await server.listen()
    const baseUrl = server.resolvedUrls?.local?.[0]
    if (!baseUrl) throw new Error('Desktop visual Vite server did not expose a local URL')
    browser = await chromium.launch({ headless: true })
    for (const viewport of DESKTOP_VISUAL_VIEWPORTS) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
      const page = await context.newPage()
      const diagnostics = bindDiagnostics(page)
      try {
        await page.goto(new URL('/favicon.svg', baseUrl).href, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await seedBrowserDatabase(page, snapshot)
        let applicationStarted = false
        for (const scenario of DESKTOP_VISUAL_SCENARIOS) {
          const screenshot = capturePath(runtimeRoot, viewport, scenario)
          captures.push(await captureScenario({
            page,
            runtime: 'renderer',
            viewport,
            scenario,
            screenshot,
            build,
            diagnostics,
            navigate: async (pathname) => {
              if (!applicationStarted) {
                await page.goto(new URL(pathname, baseUrl).href, {
                  waitUntil: 'domcontentloaded',
                  timeout: 30_000,
                })
                applicationStarted = true
                return
              }
              await page.evaluate((nextPathname) => {
                history.pushState({}, '', nextPathname)
                dispatchEvent(new PopStateEvent('popstate'))
              }, pathname)
            },
          }))
        }
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser?.close().catch(() => {})
    await server.close().catch(() => {})
  }
  return {
    captures,
    isolation: {
      browserContexts: DESKTOP_VISUAL_VIEWPORTS.length,
      database: 'trader-atlas-v3 inside ephemeral Playwright contexts',
      realLibraryAccessed: false,
    },
  }
}

async function runElectronQa({ root, runtimeRoot, build, snapshot, packageJson }) {
  for (const required of ['dist/index.html', 'dist-electron/main.js']) {
    if (!existsSync(resolve(root, required))) {
      throw new Error(`${required} is missing; run pnpm build:app before Electron visual QA`)
    }
  }
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'trader-atlas-desktop-visual-'))
  const userDataPath = join(temporaryRoot, 'user-data')
  const libraryPath = join(temporaryRoot, 'library')
  mkdirSync(userDataPath, { recursive: true })
  mkdirSync(libraryPath, { recursive: true })
  const applicationDataRoots = realApplicationDataRoots(packageJson)
  assertSafeElectronIsolationPaths({
    userDataPath,
    libraryPath,
    temporaryRoot,
    realApplicationDataRoots: applicationDataRoots,
  })
  const executablePath = require('electron')
  let application
  const captures = []
  let actualUserDataPath = null
  let actualLibraryPath = null
  try {
    application = await electron.launch({
      executablePath,
      args: ['.', `--user-data-dir=${userDataPath}`],
      cwd: root,
      env: {
        ...process.env,
        TRADER_ATLAS_LIBRARY: libraryPath,
        VITE_DEV_SERVER_URL: '',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      timeout: 30_000,
    })
    const page = await application.firstWindow({ timeout: 30_000 })
    const diagnostics = bindDiagnostics(page)
    actualUserDataPath = await application.evaluate(({ app }) => app.getPath('userData'))
    assertSafeElectronIsolationPaths({
      userDataPath: actualUserDataPath,
      libraryPath,
      temporaryRoot,
      realApplicationDataRoots: applicationDataRoots,
    })
    const created = await page.evaluate(async (nextLibraryPath) => {
      if (!window.journalBridge) throw new Error('Desktop visual Electron bridge is unavailable')
      return window.journalBridge.createNewLibrary(nextLibraryPath)
    }, libraryPath)
    if (!created.ok) throw new Error(`Desktop visual Electron library creation failed: ${created.error ?? 'unknown error'}`)
    actualLibraryPath = await page.evaluate(async () => {
      if (!window.journalBridge) throw new Error('Desktop visual Electron bridge is unavailable')
      return window.journalBridge.getLibraryPath()
    })
    assertSafeElectronIsolationPaths({
      userDataPath: actualUserDataPath,
      libraryPath: actualLibraryPath,
      temporaryRoot,
      realApplicationDataRoots: applicationDataRoots,
    })
    const imported = await page.evaluate(async (payload) => {
      if (!window.journalBridge) return false
      return window.journalBridge.commitImport(payload, [], { pruneUnreferenced: true })
    }, snapshot)
    if (!imported) throw new Error('Desktop visual Electron fixture import failed')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })

    for (const viewport of DESKTOP_VISUAL_VIEWPORTS) {
      await application.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Desktop visual Electron window is unavailable')
        if (window.isMaximized()) window.unmaximize()
        window.setSize(size.width, size.height)
      }, viewport)
      for (const scenario of DESKTOP_VISUAL_SCENARIOS) {
        const screenshot = capturePath(runtimeRoot, viewport, scenario)
        captures.push(await captureScenario({
          page,
          runtime: 'electron',
          viewport,
          scenario,
          screenshot,
          build,
          diagnostics,
          navigate: async (pathname) => {
            await page.evaluate((nextPath) => {
              window.location.hash = `#${nextPath}`
            }, pathname)
          },
        }))
      }
    }
  } finally {
    await application?.close().catch(() => {})
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  return {
    captures,
    isolation: {
      temporaryRoot,
      requestedUserDataPath: userDataPath,
      actualUserDataPath,
      requestedLibraryPath: libraryPath,
      actualLibraryPath,
      realLibraryAccessed: false,
      cleaned: true,
    },
  }
}

function normalizeScreenshotPaths(report, root) {
  return {
    ...report,
    captures: report.captures.map((capture) => ({
      ...capture,
      screenshot: relative(root, capture.screenshot).replaceAll('\\', '/'),
    })),
  }
}

export async function runDesktopVisualQa({
  runtime = 'renderer',
  root = process.cwd(),
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  if (runtime !== 'renderer' && runtime !== 'electron') {
    throw new Error(`Unsupported desktop visual runtime: ${runtime}`)
  }
  const resolvedRoot = resolve(root)
  const packageJson = JSON.parse(readFileSync(resolve(resolvedRoot, 'package.json'), 'utf8'))
  const build = sourceBuild(resolvedRoot, packageJson)
  const snapshot = createDesktopVisualSnapshot()
  const output = ensureRuntimeOutput(outputRoot, runtime)
  const result = runtime === 'renderer'
    ? await runRendererQa({ root: resolvedRoot, runtimeRoot: output.runtimeRoot, build, snapshot })
    : await runElectronQa({ root: resolvedRoot, runtimeRoot: output.runtimeRoot, build, snapshot, packageJson })
  const report = normalizeScreenshotPaths({
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    build,
    runtime,
    machine: { platform: platform(), release: release(), arch: arch(), node: process.version },
    viewport: DESKTOP_VISUAL_VIEWPORTS,
    scenario: DESKTOP_VISUAL_SCENARIOS,
    screenshot: relative(resolvedRoot, output.runtimeRoot).replaceAll('\\', '/'),
    consoleErrors: result.captures.flatMap((capture) => capture.consoleErrors),
    pageErrors: result.captures.flatMap((capture) => capture.pageErrors),
    metrics: {
      captureCount: result.captures.length,
      overflowCaptureCount: result.captures.filter((capture) => capture.metrics.horizontalOverflowPx > 0).length,
    },
    isolation: result.isolation,
    captures: result.captures,
  }, resolvedRoot)
  const reportPath = join(output.root, `${runtime}-report.json`)
  mkdirSync(output.root, { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stderr.write(`desktop visual QA report: ${reportPath}\n`)
  return report
}

export function desktopVisualReportHasFailures(report) {
  return report.consoleErrors.length > 0 ||
    report.pageErrors.length > 0 ||
    report.metrics.overflowCaptureCount > 0
}

async function main() {
  const runtime = process.argv.includes('--electron') ? 'electron' : 'renderer'
  const report = await runDesktopVisualQa({ runtime })
  process.stdout.write(`${JSON.stringify({
    runtime: report.runtime,
    captures: report.captures.length,
    consoleErrors: report.consoleErrors.length,
    pageErrors: report.pageErrors.length,
    overflowCaptures: report.metrics.overflowCaptureCount,
  }, null, 2)}\n`)
  if (desktopVisualReportHasFailures(report)) process.exitCode = 1
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) await main()

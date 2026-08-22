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
import { createDesktopVisualSeedEnvelope } from './fixtures/desktop-visual-seed.mjs'
import {
  buildTypographyCheckResult,
  hasExactDesktopVisualCaptureMatrix,
} from './packaged-desktop-visual-contract.mjs'
import {
  closeElectronApplicationBounded,
  collectElectronBundleIdentity,
  readRepositoryBuildExpectation,
  removeTemporaryDirectoryBounded,
} from './bundle-build-identity.mjs'
import { runElectronVisualEvidenceRunner } from './electron-evidence-runner.mjs'

export { runElectronVisualEvidenceRunner } from './electron-evidence-runner.mjs'
export { removeTemporaryDirectoryBounded } from './bundle-build-identity.mjs'

const require = createRequire(import.meta.url)
const REPORT_SCHEMA_VERSION = 1
const DEFAULT_OUTPUT_ROOT = resolve('.gstack/qa-reports/desktop-visual-convergence')
const TYPOGRAPHY_PROBE_SELECTORS = Object.freeze({
  latin: '.qa-type-latin',
  cjk: '.qa-type-cjk',
  mixed: '.qa-type-mixed',
  numeric: '.qa-type-numeric',
})

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

async function seedBrowserDatabase(page, seed) {
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
  }, { payload: seed.snapshot, schemaVersion: seed.schemaVersion })
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

async function collectTypographyEvidence(page, hostPlatform) {
  await page.evaluate(() => {
    document.querySelector('#atlas-typography-probes')?.remove()
    const root = document.createElement('div')
    root.id = 'atlas-typography-probes'
    root.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none;'
    root.innerHTML = [
      '<span class="qa-type-latin">Trader Atlas EURUSD 123</span>',
      '<span class="qa-type-cjk">交易日志盘面摘要</span>',
      '<span class="qa-type-mixed">XAUUSD 多 15M 8月13日</span>',
      '<span class="qa-type-numeric">+2.4R 2,346.80 21:45</span>',
    ].join('')
    document.body.append(root)
  })

  const computed = await page.evaluate((selectors) => {
    const pickStyle = (element) => {
      if (!(element instanceof HTMLElement)) throw new Error('typography probe is missing')
      const style = getComputedStyle(element)
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        fontVariantNumeric: style.fontVariantNumeric,
      }
    }
    const probeRendering = Object.fromEntries(Object.entries(selectors).map(([id, selector]) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error(`typography probe is missing: ${selector}`)
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return [id, {
        display: style.display,
        width: bounds.width,
        height: bounds.height,
        rendered: style.display !== 'none' && bounds.width > 0 && bounds.height > 0,
      }]
    }))
    const group = document.querySelector('.trade-list-group-header')
    const headerItem = document.querySelector('.trade-list-virtual-item.is-header')
    if (!(group instanceof HTMLElement) || !(headerItem instanceof HTMLElement)) {
      throw new Error('month group geometry probe is missing')
    }
    return {
      interLoaded: document.fonts.check('13px "Inter Variable"', 'Trader Atlas 123'),
      body: pickStyle(document.body),
      row: pickStyle(document.querySelector('.trade-row')),
      metadata: pickStyle(document.querySelector('.trade-list-column')),
      group: pickStyle(group.querySelector('strong')),
      probes: Object.fromEntries(Object.entries(selectors).map(([id, selector]) => [
        id,
        pickStyle(document.querySelector(selector)),
      ])),
      probeRendering,
      monthGroupHeight: group.getBoundingClientRect().height,
      monthTopGap: getComputedStyle(headerItem).paddingTop,
      monthVirtualHeight: headerItem.getBoundingClientRect().height,
    }
  }, TYPOGRAPHY_PROBE_SELECTORS)

  const session = await page.context().newCDPSession(page)
  const glyphFonts = {}
  try {
    await session.send('DOM.enable')
    await session.send('CSS.enable')
    const { root } = await session.send('DOM.getDocument')
    for (const [id, selector] of Object.entries(TYPOGRAPHY_PROBE_SELECTORS)) {
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector })
      if (!nodeId) throw new Error(`typography CDP probe is missing: ${selector}`)
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
      glyphFonts[id] = fonts
    }
  } finally {
    await session.detach().catch(() => {})
    await page.evaluate(() => document.querySelector('#atlas-typography-probes')?.remove())
  }

  const result = buildTypographyCheckResult({ platform: hostPlatform, computed, glyphFonts })
  return {
    platform: hostPlatform,
    computed,
    glyphFonts,
    ...result,
  }
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
  afterSettlement,
}) {
  diagnostics.console.length = 0
  diagnostics.page.length = 0
  await navigate(scenario.path)
  await waitForVisualSettlement(page, scenario.ready)
  await afterSettlement?.()
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

async function runRendererQa({ root, runtimeRoot, build, seed }) {
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
  let typography = null
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
        await seedBrowserDatabase(page, seed)
        let applicationStarted = false
        for (const scenario of DESKTOP_VISUAL_SCENARIOS) {
          const screenshot = capturePath(runtimeRoot, viewport, scenario)
          const capture = await captureScenario({
            page,
            runtime: 'renderer',
            viewport,
            scenario,
            screenshot,
            build,
            diagnostics,
            afterSettlement: !typography && scenario.id === 'trades'
              ? async () => { typography = await collectTypographyEvidence(page, platform()) }
              : undefined,
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
          })
          captures.push(capture)
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
    typography,
    isolation: {
      browserContexts: DESKTOP_VISUAL_VIEWPORTS.length,
      database: 'trader-atlas-v3 inside ephemeral Playwright contexts',
      realLibraryAccessed: false,
    },
  }
}

async function runElectronQa({
  root,
  runtimeRoot,
  build,
  snapshot,
  packageJson,
  buildExpectation,
  writeReport,
}) {
  for (const required of ['dist/index.html', 'dist-electron/main.js']) {
    if (!existsSync(resolve(root, required))) {
      throw new Error(`${required} is missing; run pnpm build:app before Electron visual QA`)
    }
  }
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'trader-atlas-desktop-visual-'))
  const userDataPath = join(temporaryRoot, 'user-data')
  const libraryPath = join(temporaryRoot, 'library')
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
  let typography = null
  let actualUserDataPath = null
  let actualLibraryPath = null
  let page
  let diagnostics
  let mainProcessId = null
  return runElectronVisualEvidenceRunner({
    readBundleIdentity: async () => {
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
      page = await application.firstWindow({ timeout: 30_000 })
      mainProcessId = await application.evaluate(() => process.pid)
      return collectElectronBundleIdentity({ page, application, expectation: buildExpectation })
    },
    createLibrary: async (bundleIdentity) => {
      build = {
        ...build,
        commit: bundleIdentity.bundles.renderer.commit,
        dirty: bundleIdentity.bundles.renderer.dirty,
        status: [],
        bundleIdentity,
      }
      diagnostics = bindDiagnostics(page)
      actualUserDataPath = await application.evaluate(({ app }) => app.getPath('userData'))
      assertSafeElectronIsolationPaths({
        userDataPath: actualUserDataPath,
        libraryPath,
        temporaryRoot,
        realApplicationDataRoots: applicationDataRoots,
      })
      mkdirSync(libraryPath, { recursive: true })
      const created = await page.evaluate(async (nextLibraryPath) => {
        if (!window.journalBridge) throw new Error('Desktop visual Electron bridge is unavailable')
        return window.journalBridge.createNewLibrary(nextLibraryPath)
      }, libraryPath)
      if (!created.ok) {
        throw new Error(`Desktop visual Electron library creation failed: ${created.error ?? 'unknown error'}`)
      }
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
      return actualLibraryPath
    },
    seedLibrary: async () => {
      const imported = await page.evaluate(async (payload) => {
        if (!window.journalBridge) return false
        return window.journalBridge.commitImport(payload, [], { pruneUnreferenced: true })
      }, snapshot)
      if (!imported) throw new Error('Desktop visual Electron fixture import failed')
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
      return snapshot
    },
    captureEvidence: async () => {
      for (const viewport of DESKTOP_VISUAL_VIEWPORTS) {
        await application.evaluate(({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0]
          if (!window) throw new Error('Desktop visual Electron window is unavailable')
          if (window.isMaximized()) window.unmaximize()
          window.setSize(size.width, size.height)
        }, viewport)
        for (const scenario of DESKTOP_VISUAL_SCENARIOS) {
          const screenshot = capturePath(runtimeRoot, viewport, scenario)
          const capture = await captureScenario({
            page,
            runtime: 'electron',
            viewport,
            scenario,
            screenshot,
            build,
            diagnostics,
            afterSettlement: !typography && scenario.id === 'trades'
              ? async () => { typography = await collectTypographyEvidence(page, platform()) }
              : undefined,
            navigate: async (pathname) => {
              await page.evaluate((nextPath) => {
                window.location.hash = `#${nextPath}`
              }, pathname)
            },
          })
          captures.push(capture)
        }
      }
      return {
        build,
        captures,
        typography,
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
    },
    cleanupEvidence: async () => {
      const errors = []
      try {
        await closeElectronApplicationBounded(application, { mainProcessId })
      } catch (error) {
        errors.push(error)
      }
      try {
        await removeTemporaryDirectoryBounded(temporaryRoot)
      } catch (error) {
        errors.push(error)
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'Electron visual cleanup failed')
    },
    writeReport,
  })
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
  const buildExpectation = await readRepositoryBuildExpectation(resolvedRoot)
  const seed = createDesktopVisualSeedEnvelope()
  const output = ensureRuntimeOutput(outputRoot, runtime)
  const writeReport = async (result) => {
    const reportBuild = result.build ?? build
    const report = normalizeScreenshotPaths({
      schemaVersion: REPORT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      build: reportBuild,
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
      typography: result.typography,
      isolation: result.isolation,
      captures: result.captures,
    }, resolvedRoot)
    const reportPath = join(output.root, `${runtime}-report.json`)
    mkdirSync(output.root, { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    process.stderr.write(`desktop visual QA report: ${reportPath}\n`)
    return report
  }
  if (runtime === 'renderer') {
    const result = await runRendererQa({ root: resolvedRoot, runtimeRoot: output.runtimeRoot, build, seed })
    return writeReport(result)
  }
  return runElectronQa({
    root: resolvedRoot,
    runtimeRoot: output.runtimeRoot,
    build,
    snapshot: seed.snapshot,
    packageJson,
    buildExpectation,
    writeReport,
  })
}

export function desktopVisualReportHasFailures(report) {
  return report.consoleErrors.length > 0 ||
    report.pageErrors.length > 0 ||
    report.metrics.overflowCaptureCount > 0 ||
    report.typography?.failureCount !== 0 ||
    !hasExactDesktopVisualCaptureMatrix(report.captures)
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
    typographyChecks: report.typography?.checks ?? [],
  }, null, 2)}\n`)
  if (desktopVisualReportHasFailures(report)) process.exitCode = 1
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) await main()

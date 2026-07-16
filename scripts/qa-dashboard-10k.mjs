import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright'
import { preview } from 'vite'

import {
  selectCurrentDashboardTrades,
  summarizeTimings,
} from './benchmark-analytics.mjs'
import {
  ANALYTICS_FIXTURE_SEED,
  checksumFixture,
  createAnalyticsSnapshot,
  inspectAnalyticsFixture,
} from './fixtures/analytics-trades.mjs'

const ABSOLUTE_BUDGETS_MS = Object.freeze({
  dashboardEntryP95Ms: 180,
  rangeSwitchP95Ms: 180,
  coldHydrateMs: 1_500,
  warmHydrateP95Ms: 750,
  snapshotSaveP95Ms: 1_200,
})

export function evaluateDashboardQa(observation) {
  const checks = [
    {
      id: 'fixture-checksum',
      passed: observation.loadedChecksum === observation.expectedChecksum,
      expected: observation.expectedChecksum,
      actual: observation.loadedChecksum,
    },
    {
      id: 'closed-count',
      passed: observation.renderedClosedCount === observation.expectedClosedCount,
      expected: observation.expectedClosedCount,
      actual: observation.renderedClosedCount,
    },
    { id: 'kpi-cards', passed: observation.cardCount === 4, expected: 4, actual: observation.cardCount },
    { id: 'dashboard-panels', passed: observation.panelCount === 3, expected: 3, actual: observation.panelCount },
    { id: 'data-health', passed: observation.hasDataHealth === true, expected: true, actual: observation.hasDataHealth },
    { id: 'console-errors', passed: observation.consoleErrors.length === 0, expected: 0, actual: observation.consoleErrors.length },
    { id: 'page-errors', passed: observation.pageErrors.length === 0, expected: 0, actual: observation.pageErrors.length },
  ]
  const budgetResults = Object.fromEntries(
    Object.entries(ABSOLUTE_BUDGETS_MS).map(([key, budgetMs]) => [
      key,
      {
        actualMs: observation[key],
        budgetMs,
        withinBudget: observation[key] <= budgetMs,
      },
    ]),
  )
  const functionalPassed = checks.every((check) => check.passed)
  const withinAllAbsoluteBudgets = Object.values(budgetResults).every(
    (result) => result.withinBudget,
  )
  return {
    functionalPassed,
    releasePassed: functionalPassed && withinAllAbsoluteBudgets,
    checks,
    performance: {
      enforced: true,
      reason: '10K 仪表盘门禁执行冻结的绝对性能预算。',
      withinAllAbsoluteBudgets,
      budgets: budgetResults,
    },
  }
}

function roundMs(value) {
  return Math.round(value * 1_000) / 1_000
}

async function waitForDashboard(page) {
  await page.locator('.db-scroll').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.documentElement.dataset.uiSettled === '1', null, {
    timeout: 30_000,
  })
  await page.evaluate(
    () => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))),
  )
}

async function writeSnapshotToIsolatedIndexedDb(page, snapshotJson, fixtureChecksum) {
  await page.evaluate(
    async ({ json, checksum }) => {
      const snapshot = JSON.parse(json)
      const db = await new Promise((resolveDb, reject) => {
        const request = indexedDB.open('linear-journal-v3', 1)
        request.onupgradeneeded = () => {
          const nextDb = request.result
          if (!nextDb.objectStoreNames.contains('snapshot')) nextDb.createObjectStore('snapshot')
          if (!nextDb.objectStoreNames.contains('assets')) {
            nextDb.createObjectStore('assets', { keyPath: 'id' })
          }
          if (!nextDb.objectStoreNames.contains('meta')) nextDb.createObjectStore('meta')
        }
        request.onsuccess = () => resolveDb(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise((resolveWrite, reject) => {
        const tx = db.transaction(['snapshot', 'meta'], 'readwrite')
        tx.objectStore('snapshot').put(snapshot, 'main')
        tx.objectStore('meta').put(
          {
            schemaVersion: 6,
            libraryId: 'analytics-10k-isolated',
            createdAt: '2026-07-15T00:00:00.000Z',
            platform: 'web',
            fixtureChecksum: checksum,
          },
          'manifest',
        )
        tx.oncomplete = resolveWrite
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      db.close()
    },
    { json: snapshotJson, checksum: fixtureChecksum },
  )
}

async function readFixtureChecksum(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolveDb, reject) => {
      const request = indexedDB.open('linear-journal-v3', 1)
      request.onsuccess = () => resolveDb(request.result)
      request.onerror = () => reject(request.error)
    })
    const checksum = await new Promise((resolveValue, reject) => {
      const request = db.transaction('meta', 'readonly').objectStore('meta').get('manifest')
      request.onsuccess = () => resolveValue(request.result?.fixtureChecksum ?? null)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return checksum
  })
}

async function deleteIsolatedDatabase(page) {
  await page.evaluate(async () => {
    await new Promise((resolveDelete) => {
      const request = indexedDB.deleteDatabase('linear-journal-v3')
      request.onsuccess = resolveDelete
      request.onerror = resolveDelete
      request.onblocked = resolveDelete
    })
  }).catch(() => {})
}

async function measureReload(page) {
  const startedAt = performance.now()
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  await waitForDashboard(page)
  return performance.now() - startedAt
}

async function routeInApp(page, pathname) {
  return page.evaluate(async (nextPathname) => {
    const startedAt = performance.now()
    history.pushState({}, '', nextPathname)
    dispatchEvent(new PopStateEvent('popstate'))
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))
    return performance.now() - startedAt
  }, pathname)
}

async function measureDashboardEntry(page) {
  await routeInApp(page, '/settings/profile')
  const elapsed = await routeInApp(page, '/dashboard')
  await page.locator('.db-scroll').waitFor({ state: 'visible', timeout: 30_000 })
  return elapsed
}

async function measureRangeSwitch(page, rangeName) {
  return page.evaluate(async (label) => {
    const button = [...document.querySelectorAll('button.db-seg')]
      .find((candidate) => candidate.textContent?.trim() === label)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing range button: ${label}`)
    const startedAt = performance.now()
    button.click()
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))
    return performance.now() - startedAt
  }, rangeName)
}

async function measureSnapshotSave(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolveDb, reject) => {
      const request = indexedDB.open('linear-journal-v3', 1)
      request.onsuccess = () => resolveDb(request.result)
      request.onerror = () => reject(request.error)
    })
    const snapshot = await new Promise((resolveValue, reject) => {
      const request = db.transaction('snapshot', 'readonly').objectStore('snapshot').get('main')
      request.onsuccess = () => resolveValue(request.result)
      request.onerror = () => reject(request.error)
    })
    const startedAt = performance.now()
    await new Promise((resolveWrite, reject) => {
      const tx = db.transaction('snapshot', 'readwrite')
      tx.objectStore('snapshot').put(snapshot, 'main')
      tx.oncomplete = resolveWrite
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    const elapsed = performance.now() - startedAt
    db.close()
    return elapsed
  })
}

async function measureRepeated(operation, { warmups, runs }) {
  for (let index = 0; index < warmups; index += 1) await operation(index)
  const rawMs = []
  for (let index = 0; index < runs; index += 1) rawMs.push(await operation(index))
  return summarizeTimings(rawMs)
}

async function browserHeapMetrics(session) {
  const response = await session.send('Performance.getMetrics')
  return Object.fromEntries(
    response.metrics
      .filter((metric) => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'LayoutCount'].includes(metric.name))
      .map((metric) => [metric.name, metric.value]),
  )
}

function reportPath(version) {
  const outputDir = join(tmpdir(), 'yunkoo-atlas', 'analytics-baseline')
  mkdirSync(outputDir, { recursive: true })
  return join(outputDir, `dashboard-10k-${version}-${platform()}-${arch()}.json`)
}

export async function runDashboard10kQa({ smoke = false, stdoutOnly = false } = {}) {
  const distIndex = resolve('dist/index.html')
  if (!existsSync(distIndex)) {
    throw new Error('dist/index.html is missing; run the production build before qa:dashboard-10k')
  }
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const warmups = smoke ? 1 : 5
  const runs = smoke ? 2 : 30
  const snapshot = createAnalyticsSnapshot({
    count: 10_000,
    seed: ANALYTICS_FIXTURE_SEED,
    noteProfile: '2kb',
  })
  const snapshotJson = JSON.stringify(snapshot)
  const expectedChecksum = checksumFixture(snapshot.trades)
  const expectedClosedCount = selectCurrentDashboardTrades(snapshot.trades, {
    kind: 'live',
    range: 'all',
    now: new Date('2026-07-15T00:00:00.000Z'),
  }).length
  const errors = { console: [], page: [] }
  let previewServer
  let browser
  let context
  let page
  let baseUrl
  let report

  try {
    const configuredBaseUrl = process.env.QA_BASE_URL
    if (!configuredBaseUrl) {
      previewServer = await preview({
        configFile: resolve('vite.config.ts'),
        logLevel: 'error',
        preview: { host: '127.0.0.1', port: 0, open: false },
      })
    }
    baseUrl = configuredBaseUrl ?? previewServer?.resolvedUrls?.local?.[0]
    if (!baseUrl) throw new Error('Production preview did not expose a local URL')

    browser = await chromium.launch({
      headless: true,
      args: ['--enable-precise-memory-info'],
    })
    context = await browser.newContext({
      viewport: { width: 1_440, height: 900 },
      deviceScaleFactor: 1,
    })
    page = await context.newPage()
    page.on('pageerror', (error) => errors.page.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('React Router Future Flag')) {
        errors.console.push(message.text())
      }
    })
    const session = await context.newCDPSession(page)
    await session.send('Performance.enable')

    // 先进入不执行应用脚本的同源静态资源，避免空库启动后的待保存状态覆盖 fixture。
    await page.goto(new URL('/favicon.svg', baseUrl).href, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    const memoryBefore = await browserHeapMetrics(session)
    await writeSnapshotToIsolatedIndexedDb(page, snapshotJson, expectedChecksum)
    const coldStartedAt = performance.now()
    await page.goto(new URL('/dashboard', baseUrl).href, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await waitForDashboard(page)
    const coldHydrateMs = roundMs(performance.now() - coldStartedAt)

    const warmHydrate = await measureRepeated(() => measureReload(page), { warmups, runs })
    const dashboardEntry = await measureRepeated(() => measureDashboardEntry(page), { warmups, runs })
    let nextRange = '近90天'
    const rangeSwitch = await measureRepeated(async () => {
      const elapsed = await measureRangeSwitch(page, nextRange)
      nextRange = nextRange === '近90天' ? '全部' : '近90天'
      return elapsed
    }, { warmups, runs })
    if (nextRange === '全部') await measureRangeSwitch(page, '全部')
    const snapshotSave = await measureRepeated(() => measureSnapshotSave(page), { warmups, runs })
    const memoryAfter = await browserHeapMetrics(session)

    const loadedChecksum = await readFixtureChecksum(page)
    const cardCount = await page.locator('.db-card').count()
    const panelCount = await page.locator('.db-panel').count()
    const hasDataHealth = await page.locator('.db-data-health').isVisible().catch(() => false)
    const dashboardText = await page.locator('.db-scroll').innerText()
    const renderedClosedCount = Number(/(\d+) 笔已平仓/.exec(dashboardText)?.[1] ?? Number.NaN)
    const svgElementCount = await page.locator('.db-chart svg *').count()
    const dotElementCount = await page.locator('.recharts-dot').count()
    const observation = {
      expectedChecksum,
      loadedChecksum,
      expectedClosedCount,
      renderedClosedCount,
      cardCount,
      panelCount,
      hasDataHealth,
      consoleErrors: errors.console,
      pageErrors: errors.page,
      dashboardEntryP95Ms: dashboardEntry.p95Ms,
      rangeSwitchP95Ms: rangeSwitch.p95Ms,
      coldHydrateMs,
      warmHydrateP95Ms: warmHydrate.p95Ms,
      snapshotSaveP95Ms: snapshotSave.p95Ms,
    }
    const evaluation = evaluateDashboardQa(observation)
    report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      application: {
        name: packageJson.name,
        version: packageJson.version,
        build: 'production-preview',
        distIndexBytes: Buffer.byteLength(readFileSync(distIndex)),
      },
      machine: {
        platform: platform(),
        release: release(),
        arch: arch(),
        cpuModel: cpus()[0]?.model ?? 'unknown',
        logicalCpuCount: cpus().length,
        node: process.version,
      },
      viewport: { width: 1_440, height: 900, deviceScaleFactor: 1 },
      measurementPolicy: { mode: smoke ? 'smoke' : 'baseline', warmups, runs },
      isolation: {
        browserContext: 'ephemeral',
        database: 'linear-journal-v3 inside ephemeral context',
        realLibraryAccessed: false,
        cleanupAttempted: true,
      },
      fixture: {
        count: snapshot.trades.length,
        noteProfile: '2kb',
        bytes: Buffer.byteLength(snapshotJson, 'utf8'),
        checksum: expectedChecksum,
        coverage: inspectAnalyticsFixture(snapshot.trades),
      },
      observation,
      timings: {
        coldHydrateMs,
        warmHydrate,
        dashboardEntry,
        rangeSwitch,
        snapshotSave,
      },
      rendering: { svgElementCount, dotElementCount },
      memory: {
        before: memoryBefore,
        after: memoryAfter,
        jsHeapUsedDeltaBytes:
          (memoryAfter.JSHeapUsedSize ?? 0) - (memoryBefore.JSHeapUsedSize ?? 0),
      },
      evaluation,
    }
  } finally {
    if (page && baseUrl) {
      await page.goto(new URL('/favicon.svg', baseUrl).href, {
        waitUntil: 'domcontentloaded',
        timeout: 10_000,
      }).catch(() => {})
      await deleteIsolatedDatabase(page)
    }
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await previewServer?.close().catch(() => {})
  }

  if (!report) throw new Error('Dashboard QA did not produce a report')
  if (!stdoutOnly) {
    const output = reportPath(report.application.version)
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    process.stderr.write(`dashboard 10k QA report: ${output}\n`)
  }
  return report
}

async function main() {
  const report = await runDashboard10kQa({
    smoke: process.argv.includes('--smoke'),
    stdoutOnly: process.argv.includes('--stdout-only'),
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.evaluation.releasePassed) process.exitCode = 1
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) await main()

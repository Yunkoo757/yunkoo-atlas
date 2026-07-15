import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const PORT = Number(process.env.QA_PERF_PORT ?? 5191)
const EXTERNAL_BASE = process.env.QA_PERF_BASE_URL
const BASE = EXTERNAL_BASE ?? `http://127.0.0.1:${PORT}`
const SAMPLE_COUNT = Number(process.env.QA_PERF_SAMPLES ?? 7)
const OUT_DIR = join(process.cwd(), 'qa-screenshots')
const REPORT_PATH = join(OUT_DIR, 'performance-report.json')

const budgets = {
  appReadyP95Ms: Number(process.env.QA_PERF_READY_P95_MS ?? 1000),
  fcpP95Ms: Number(process.env.QA_PERF_FCP_P95_MS ?? 1000),
  initialJsBytes: Number(process.env.QA_PERF_JS_BYTES ?? 500 * 1024),
  initialCssBytes: Number(process.env.QA_PERF_CSS_BYTES ?? 180 * 1024),
  totalEncodedBytes: Number(process.env.QA_PERF_TOTAL_BYTES ?? 900 * 1024),
  requestCount: Number(process.env.QA_PERF_REQUESTS ?? 24),
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  return sorted[index]
}

function round(value) {
  return Math.round(value * 10) / 10
}

function formatBytes(value) {
  return `${round(value / 1024)} KiB`
}

function startPreview() {
  if (EXTERNAL_BASE) return null
  return spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--strictPort',
    ],
    { cwd: process.cwd(), stdio: 'ignore' },
  )
}

async function waitForPreview(child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`生产预览在就绪前退出，退出码 ${child.exitCode}。`)
    }
    try {
      const response = await fetch(BASE)
      const html = await response.text()
      if (response.ok && !html.includes('/@vite/client') && html.includes('<div id="root">')) return
    } catch {
      // 生产预览仍在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('生产预览在 12 秒内未就绪。请先运行 pnpm build:app。')
}

async function stopPreview(child) {
  if (!child || child.exitCode !== null) return
  const stopped = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 1500))])
}

async function captureSample(browser, index) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  const runtimeErrors = []
  const failedRequests = []

  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('React Router Future Flag')) {
      runtimeErrors.push(`console: ${message.text()}`)
    }
  })
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'failed'})`)
  })

  await page.addInitScript(() => {
    window.__qaAppReadyAt = null
    const markReady = () => {
      if (window.__qaAppReadyAt === null && document.querySelector('.ui-main-frame')) {
        window.__qaAppReadyAt = performance.now()
      }
    }
    new MutationObserver(markReady).observe(document, { childList: true, subtree: true })
    document.addEventListener('DOMContentLoaded', markReady, { once: true })
  })

  try {
    await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.locator('.ui-main-frame').waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForLoadState('networkidle', { timeout: 5000 })
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))

    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      const resources = performance.getEntriesByType('resource')
      const paints = performance.getEntriesByType('paint')
      const fcp = paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? null
      const encoded = (entry) => entry.encodedBodySize || entry.transferSize || 0
      const isJs = (entry) => entry.name.endsWith('.js') || entry.initiatorType === 'script'
      const isCss = (entry) => entry.name.endsWith('.css')
      const baseOrigin = location.origin

      return {
        appReadyMs: window.__qaAppReadyAt ?? performance.now(),
        fcpMs: fcp,
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
        loadMs: navigation?.loadEventEnd ?? 0,
        initialJsBytes: resources.filter(isJs).reduce((sum, entry) => sum + encoded(entry), 0),
        initialCssBytes: resources.filter(isCss).reduce((sum, entry) => sum + encoded(entry), 0),
        totalEncodedBytes:
          (navigation ? encoded(navigation) : 0) +
          resources.reduce((sum, entry) => sum + encoded(entry), 0),
        requestCount: resources.length + 1,
        externalRequests: resources
          .map((entry) => entry.name)
          .filter((url) => new URL(url).origin !== baseOrigin),
      }
    })

    return {
      sample: index,
      ...Object.fromEntries(
        Object.entries(metrics).map(([key, value]) => [
          key,
          typeof value === 'number' ? round(value) : value,
        ]),
      ),
      runtimeErrors,
      failedRequests,
    }
  } finally {
    await context.close()
  }
}

function check(name, actual, budget, comparison = '<=') {
  const pass = comparison === '<=' ? actual <= budget : actual === budget
  const operator = comparison === '<=' ? '≤' : '='
  console.log(`${pass ? '✓' : '✗'} ${name}: ${actual}（门槛 ${operator} ${budget}）`)
  return { name, actual, budget, comparison, pass }
}

mkdirSync(OUT_DIR, { recursive: true })

const preview = startPreview()
let browser

try {
  await waitForPreview(preview)
  browser = await chromium.launch({ headless: true })

  // 预热生产预览与浏览器进程，正式样本仍各自使用独立无痕上下文。
  const warmup = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const warmupPage = await warmup.newPage()
  await warmupPage.goto(`${BASE}/list`, { waitUntil: 'networkidle', timeout: 15000 })
  await warmup.close()

  const samples = []
  for (let index = 1; index <= SAMPLE_COUNT; index += 1) {
    const sample = await captureSample(browser, index)
    samples.push(sample)
    console.log(
      `样本 ${index}/${SAMPLE_COUNT}: ready=${sample.appReadyMs}ms, FCP=${sample.fcpMs}ms, ` +
      `JS=${formatBytes(sample.initialJsBytes)}, total=${formatBytes(sample.totalEncodedBytes)}`,
    )
  }

  const appReadyValues = samples.map((sample) => sample.appReadyMs)
  const fcpValues = samples.map((sample) => sample.fcpMs).filter((value) => value !== null)
  const runtimeErrors = samples.flatMap((sample) => sample.runtimeErrors)
  const failedRequests = samples.flatMap((sample) => sample.failedRequests)
  const externalRequests = samples.flatMap((sample) => sample.externalRequests)
  const summary = {
    appReadyP50Ms: round(percentile(appReadyValues, 0.5)),
    appReadyP95Ms: round(percentile(appReadyValues, 0.95)),
    fcpP50Ms: fcpValues.length ? round(percentile(fcpValues, 0.5)) : null,
    fcpP95Ms: fcpValues.length ? round(percentile(fcpValues, 0.95)) : null,
    maxInitialJsBytes: Math.max(...samples.map((sample) => sample.initialJsBytes)),
    maxInitialCssBytes: Math.max(...samples.map((sample) => sample.initialCssBytes)),
    maxTotalEncodedBytes: Math.max(...samples.map((sample) => sample.totalEncodedBytes)),
    maxRequestCount: Math.max(...samples.map((sample) => sample.requestCount)),
    runtimeErrorCount: runtimeErrors.length,
    failedRequestCount: failedRequests.length,
    externalRequestCount: externalRequests.length,
  }

  console.log('\n--- 生产首屏性能门禁 ---')
  const checks = [
    check('首屏可交互 P95 (ms)', summary.appReadyP95Ms, budgets.appReadyP95Ms),
    check('FCP P95 (ms)', summary.fcpP95Ms ?? Number.POSITIVE_INFINITY, budgets.fcpP95Ms),
    check('初始 JS (bytes)', summary.maxInitialJsBytes, budgets.initialJsBytes),
    check('初始 CSS (bytes)', summary.maxInitialCssBytes, budgets.initialCssBytes),
    check('初始总传输 (bytes)', summary.maxTotalEncodedBytes, budgets.totalEncodedBytes),
    check('初始请求数', summary.maxRequestCount, budgets.requestCount),
    check('运行时错误数', summary.runtimeErrorCount, 0, '='),
    check('请求失败数', summary.failedRequestCount, 0, '='),
    check('外部网络请求数', summary.externalRequestCount, 0, '='),
  ]

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    sampleCount: SAMPLE_COUNT,
    budgets,
    summary,
    checks,
    samples,
    runtimeErrors,
    failedRequests,
    externalRequests,
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  console.log(`报告：${REPORT_PATH}`)

  if (checks.some((item) => !item.pass)) process.exitCode = 1
} finally {
  await browser?.close()
  await stopPreview(preview)
}

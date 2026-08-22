import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import {
  discoverBrowserTests,
  settleBrowserDiagnostics,
  unexpectedBrowserDiagnostics,
} from './test-discovery.mjs'

function browserTestId(browserTest) {
  const entry = browserTest.url.startsWith('/') ? browserTest.url.slice(1) : browserTest.url
  const variant = browserTest.viewport
    ? `@${browserTest.viewport.width}x${browserTest.viewport.height}`
    : ''
  return `${entry}#${browserTest.promiseKey}${variant}`
}

async function withTimeout(promise, milliseconds, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function isTransientBrowserSocketExhaustion(error, diagnostics) {
  const thrownMessage = error instanceof Error ? error.message : String(error)
  return [thrownMessage, ...diagnostics].some((message) => (
    message.includes('net::ERR_NO_BUFFER_SPACE')
  ))
}

export async function runBrowserRegressionTests(root, options = {}) {
  let failed = 0
  const passedEntries = new Set()
  const passedTests = []
  const failedTests = []
  const requestedTestIds = Object.hasOwn(options, 'requestedTestIds')
    ? options.requestedTestIds
    : null
  const onEvent = options.onEvent ?? (() => {})
  const testTimeoutMs = options.testTimeoutMs ?? 15_000
  const discoveredTests = await discoverBrowserTests(root)
  const testById = new Map(discoveredTests.map((browserTest) => [browserTestId(browserTest), browserTest]))
  const missingRequestedTestIds = requestedTestIds === null
    ? []
    : requestedTestIds.filter((testId) => !testById.has(testId))
  if (requestedTestIds !== null && (requestedTestIds.length === 0 || missingRequestedTestIds.length > 0)) {
    const reason = requestedTestIds.length === 0
      ? 'requested browser sample is empty'
      : `requested browser tests are not discoverable: ${missingRequestedTestIds.join(', ')}`
    console.error(`FAIL browser regression harness: ${reason}`)
    onEvent({ type: 'harness-fail', reason })
    return {
      failed: 1,
      passedEntries: [],
      passedTests: [],
      failedTests: [],
      missingRequestedTestIds,
    }
  }
  const browserTests = requestedTestIds === null
    ? discoveredTests
    : requestedTestIds.map((testId) => testById.get(testId))
  const server = await createServer({
    root,
    configFile: options.configFile ?? false,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      open: false,
      fs: { allow: [root] },
    },
  })
  let browser
  try {
    await server.listen()
    const baseUrl = server.resolvedUrls?.local[0]
    if (!baseUrl) throw new Error('Vite test server did not expose a local URL')
    browser = await chromium.launch({ headless: true })

    for (const browserTest of browserTests) {
      const testId = browserTestId(browserTest)
      for (let attempt = 0; attempt < 2; attempt += 1) {
        console.log(`START ${testId}`)
        onEvent({ type: 'start', testId, attempt: attempt + 1 })
        const page = browserTest.viewport
          ? await browser.newPage({ viewport: browserTest.viewport })
          : await browser.newPage()
        await page.addInitScript((viewport) => {
          window.$RefreshReg$ ??= () => {}
          window.$RefreshSig$ ??= () => (type) => type
          let actionsComplete = false
          let resolveActions
          const actions = new Promise((resolve) => {
            resolveActions = resolve
          })
          window.__atlasBrowserWaitForActions = () => actionsComplete ? Promise.resolve() : actions
          window.__atlasBrowserCompleteActions = () => {
            if (actionsComplete) return
            actionsComplete = true
            resolveActions()
          }
          window.__atlasBrowserViewport = viewport
        }, browserTest.viewport ?? null)
        const diagnostics = []
        page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`))
        page.on('console', (message) => {
          if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`)
        })
        try {
          await page.goto(new URL(browserTest.url, baseUrl).href)
          await page.waitForFunction((key) => key in window, browserTest.promiseKey, { timeout: testTimeoutMs })
          if (browserTest.hoverSelector) await page.hover(browserTest.hoverSelector)
          await page.evaluate(() => window.__atlasBrowserCompleteActions())
          await withTimeout(
            page.evaluate((key) => window[key], browserTest.promiseKey),
            testTimeoutMs,
            `browser test timed out after ${testTimeoutMs}ms: ${testId}`,
          )
          await settleBrowserDiagnostics(page)
          const allowedMessages = await page.evaluate(
            () => Array.isArray(window.__atlasBrowserAllowedErrors)
              ? window.__atlasBrowserAllowedErrors
              : [],
          )
          const unexpected = unexpectedBrowserDiagnostics(diagnostics, allowedMessages)
          if (unexpected.length > 0) {
            throw new Error(`unexpected browser diagnostics:\n${unexpected.join('\n')}`)
          }
          console.log(`PASS ${browserTest.label}`)
          const entry = browserTest.url.startsWith('/') ? browserTest.url.slice(1) : browserTest.url
          passedEntries.add(entry)
          passedTests.push(testId)
          onEvent({ type: 'pass', testId, attempt: attempt + 1 })
          break
        } catch (error) {
          const retry = attempt === 0 && isTransientBrowserSocketExhaustion(error, diagnostics)
          if (!retry) {
            failed += 1
            failedTests.push(testId)
            console.error(`FAIL ${browserTest.label}`)
            console.error(error)
            console.error(`URL ${page.url()}`)
            if (diagnostics.length > 0) console.error(diagnostics.join('\n'))
            onEvent({ type: 'fail', testId, attempt: attempt + 1, reason: error instanceof Error ? error.message : String(error) })
            break
          } else {
            onEvent({ type: 'retry', testId, attempt: attempt + 1, reason: 'net::ERR_NO_BUFFER_SPACE' })
          }
        } finally {
          await page.close()
        }
      }
    }
  } catch (error) {
    failed += 1
    console.error('FAIL browser regression harness')
    console.error(error)
    onEvent({ type: 'harness-fail', reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await browser?.close()
    await server.close()
  }
  return {
    failed,
    passedEntries: [...passedEntries],
    passedTests,
    failedTests,
    missingRequestedTestIds,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.argv[2] ?? process.cwd())
  const configFile = process.argv[3] ? path.resolve(process.argv[3]) : false
  const result = await runBrowserRegressionTests(root, { configFile })
  if (result.failed > 0) process.exitCode = 1
}

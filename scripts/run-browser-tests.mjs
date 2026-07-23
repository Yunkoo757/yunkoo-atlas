import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import {
  discoverBrowserTests,
  settleBrowserDiagnostics,
  unexpectedBrowserDiagnostics,
} from './test-discovery.mjs'

export async function runBrowserRegressionTests(root, options = {}) {
  let failed = 0
  const passedEntries = []
  const passedTests = []
  const server = await createServer({
    root,
    configFile: options.configFile ?? false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, open: false },
  })
  let browser
  try {
    const browserTests = await discoverBrowserTests(root)
    await server.listen()
    const baseUrl = server.resolvedUrls?.local[0]
    if (!baseUrl) throw new Error('Vite test server did not expose a local URL')
    browser = await chromium.launch({ headless: true })

    for (const browserTest of browserTests) {
      const page = await browser.newPage()
      const diagnostics = []
      page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`)
      })
      try {
        await page.goto(new URL(browserTest.url, baseUrl).href)
        await page.waitForFunction((key) => key in window, browserTest.promiseKey, { timeout: 5000 })
        await page.evaluate((key) => window[key], browserTest.promiseKey)
        await settleBrowserDiagnostics(page)
        const allowedMessages = await page.evaluate(
          () => Array.isArray(window.__linearBrowserAllowedErrors)
            ? window.__linearBrowserAllowedErrors
            : [],
        )
        const unexpected = unexpectedBrowserDiagnostics(diagnostics, allowedMessages)
        if (unexpected.length > 0) {
          throw new Error(`unexpected browser diagnostics:\n${unexpected.join('\n')}`)
        }
        console.log(`PASS ${browserTest.label}`)
        passedEntries.push(browserTest.label)
        passedTests.push(`${browserTest.label}#${browserTest.promiseKey}`)
      } catch (error) {
        failed += 1
        console.error(`FAIL ${browserTest.label}`)
        console.error(error)
        console.error(`URL ${page.url()}`)
        if (diagnostics.length > 0) console.error(diagnostics.join('\n'))
      } finally {
        await page.close()
      }
    }
  } catch (error) {
    failed += 1
    console.error('FAIL browser regression harness')
    console.error(error)
  } finally {
    await browser?.close()
    await server.close()
  }
  return { failed, passedEntries, passedTests }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.argv[2] ?? process.cwd())
  const configFile = process.argv[3] ? path.resolve(process.argv[3]) : false
  const result = await runBrowserRegressionTests(root, { configFile })
  if (result.failed > 0) process.exitCode = 1
}

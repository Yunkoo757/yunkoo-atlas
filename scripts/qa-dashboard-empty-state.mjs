import assert from 'node:assert/strict'
import path from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({
  configFile: path.resolve('vite.config.ts'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, open: false },
})

let browser
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  assert.ok(baseUrl, 'Vite test server did not expose a local URL')

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(new URL('/dashboard', baseUrl).href)
  await page.locator('.db-empty').waitFor()

  assert.equal(await page.locator('.db-panel').count(), 0)
  assert.match(await page.locator('.db-empty').innerText(), /还没有已平仓交易/)
  assert.match(await page.locator('.db-empty-action').innerText(), /新建交易/)

  await page.locator('.db-empty-action').click()
  await page.locator('.composer-overlay, .trade-composer').first().waitFor()
  assert.equal(await page.locator('.composer-overlay, .trade-composer').count() > 0, true)

  console.log('PASS dashboard empty state guides users into creating a trade')
} finally {
  await browser?.close()
  await server.close()
}

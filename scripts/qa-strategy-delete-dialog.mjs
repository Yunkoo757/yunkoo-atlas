import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({
  configFile: 'vite.config.ts',
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
  await page.goto(new URL('/settings/strategies', baseUrl).href)

  await page.getByRole('button', { name: '删除 Breakout', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()

  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '取消')
  assert.equal(await page.getByRole('tooltip').count(), 0)

  await page.getByRole('button', { name: '取消', exact: true }).press('Escape')
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS: strategy delete dialog owns focus and closes with Escape')
} finally {
  await browser?.close()
  await server.close()
}

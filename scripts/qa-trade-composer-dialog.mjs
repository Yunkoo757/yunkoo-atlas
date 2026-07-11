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
  await page.goto(new URL('/list', baseUrl).href)
  await page.getByRole('button', { name: '新建交易', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '交易品种')

  const createButton = page.getByRole('button', { name: '创建交易', exact: true })
  const closeButton = page.getByRole('button', { name: '关闭', exact: true })
  await createButton.focus()
  await createButton.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭')

  await closeButton.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '创建交易')

  await createButton.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS: trade composer contains focus and closes with Escape')
} finally {
  await browser?.close()
  await server.close()
}

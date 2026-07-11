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
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('button', { name: '管理我的空间', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: '管理我的空间' })
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '管理我的空间')

  const first = page.getByRole('button', { name: '下移 进行中', exact: true })
  const last = page.getByRole('button', { name: '完成', exact: true })
  await last.focus()
  await last.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '下移 进行中')

  await first.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '完成')

  await last.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS: mobile workspace dialog contains focus and closes with Escape')
} finally {
  await browser?.close()
  await server.close()
}

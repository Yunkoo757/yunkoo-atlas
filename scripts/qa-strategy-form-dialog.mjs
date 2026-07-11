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
  await page.getByRole('button', { name: '新建策略', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: '新建策略' })
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('placeholder')), '如 Breakout、波段趋势')

  const close = page.getByRole('button', { name: '关闭策略表单', exact: true })
  const cancel = page.getByRole('button', { name: '取消', exact: true })
  await close.focus()
  await close.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '取消')

  await cancel.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭策略表单')

  await close.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS: strategy form contains focus and closes with Escape')
} finally {
  await browser?.close()
  await server.close()
}

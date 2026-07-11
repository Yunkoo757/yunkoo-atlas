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
  await page.getByRole('button', { name: '搜索', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: '搜索与命令' })
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('placeholder')),
    '搜索交易、跳转视图…',
  )

  const input = page.getByRole('textbox', { name: '搜索交易、跳转视图…' })
  const lastItem = page.locator('.cmdk-item').last()
  await lastItem.focus()
  await lastItem.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('placeholder')), '搜索交易、跳转视图…')

  await input.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('cmdk-item')), true)

  await input.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS: command palette contains focus and closes with Escape')
} finally {
  await browser?.close()
  await server.close()
}

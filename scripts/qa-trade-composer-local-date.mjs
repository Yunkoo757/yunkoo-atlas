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
  const context = await browser.newContext({ timezoneId: 'Asia/Hong_Kong' })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-07-11T17:30:00Z'))
  await page.goto(new URL('/list', baseUrl).href)
  await page.getByRole('heading', { name: '交易日志', exact: true }).waitFor()
  await page.keyboard.press('n')
  await page.getByRole('dialog', { name: '新建交易', exact: true }).waitFor()

  const dateInput = page.getByRole('textbox', { name: '交易日期', exact: true })
  assert.equal(await dateInput.inputValue(), '2026-07-12')
  console.log('PASS: trade composer defaults to the user local calendar date')
} finally {
  await browser?.close()
  await server.close()
}

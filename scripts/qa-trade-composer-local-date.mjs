import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { startQaServer } from './qa-vite-server.mjs'

const server = await startQaServer({ configFile: 'vite.config.ts' })

let browser
try {
  const baseUrl = server.baseUrl

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

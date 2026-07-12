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
  const page = await browser.newPage()
  await page.goto(new URL('/settings/display', baseUrl).href)
  await page.getByRole('heading', { name: '分组方式', exact: true }).waitFor()

  const byMonth = page.getByRole('button', { name: /按月份/ })
  const noGroup = page.getByRole('button', { name: /不分组/ })
  assert.equal(await byMonth.getAttribute('aria-pressed'), 'true')

  await noGroup.click()
  assert.equal(await noGroup.getAttribute('aria-pressed'), 'true')
  assert.equal(await byMonth.getAttribute('aria-pressed'), 'false')

  await page.reload()
  await page.getByRole('heading', { name: '分组方式', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: /不分组/ }).getAttribute('aria-pressed'),
    'true',
  )

  assert.equal(await page.getByRole('switch', { name: /只看未结束交易/ }).count(), 1)
  assert.equal(await page.getByRole('switch', { name: /保留空状态/ }).count(), 1)
  assert.equal(await page.getByRole('button', { name: /最近交易/ }).count(), 1)

  console.log('PASS: display settings expose clear persistent choices')
} finally {
  await browser?.close()
  await server.close()
}

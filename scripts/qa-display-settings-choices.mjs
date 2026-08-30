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

  assert.equal(await page.getByRole('switch', { name: /只看未结束交易/ }).count(), 1)
  assert.equal(await page.getByRole('switch', { name: /保留空状态/ }).count(), 1)
  const recentTrades = page.getByRole('button', { name: /最近交易.*新记录在前/ })
  assert.equal(await recentTrades.count(), 1)
  assert.equal(await recentTrades.getAttribute('aria-pressed'), 'true')
  await recentTrades.click()
  assert.equal(
    await page.getByRole('button', { name: /最近交易.*旧记录在前/ }).getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(await page.getByRole('heading', { name: '排序方向', exact: true }).count(), 0)

  await page.evaluate(() => {
    history.pushState({}, '', '/list')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.getByRole('button', { name: '显示选项' }).click()
  const dateAscending = page.getByRole('menuitemradio', { name: '开仓日期，正序' })
  assert.equal(await dateAscending.getAttribute('aria-checked'), 'true')
  await dateAscending.click()
  assert.equal(
    await page.getByRole('menuitemradio', { name: '开仓日期，倒序' }).getAttribute('aria-checked'),
    'true',
  )

  await page.getByRole('menuitemradio', { name: '盈亏金额' }).click()
  const pnlDescending = page.getByRole('menuitemradio', { name: '盈亏金额，倒序' })
  assert.equal(await pnlDescending.getAttribute('aria-checked'), 'true')
  await pnlDescending.click()
  assert.equal(
    await page.getByRole('menuitemradio', { name: '盈亏金额，正序' }).getAttribute('aria-checked'),
    'true',
  )
  assert.equal(await page.getByText('方向', { exact: true }).count(), 0)

  await page.waitForTimeout(600)
  await page.reload()
  await page.getByRole('button', { name: '显示选项' }).click()
  assert.equal(
    await page.getByRole('menuitemradio', { name: '盈亏金额，正序' }).getAttribute('aria-checked'),
    'true',
  )

  await page.evaluate(() => {
    history.pushState({}, '', '/settings/display')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.getByRole('heading', { name: '默认排序', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: /盈亏表现.*从低到高/ }).getAttribute('aria-pressed'),
    'true',
  )

  console.log('PASS: display settings and menu expose persistent two-way sorting')
} finally {
  await browser?.close()
  await server.close()
}

import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { startQaServer } from './qa-vite-server.mjs'

const server = await startQaServer({ configFile: 'vite.config.ts' })

let browser
try {
  const baseUrl = server.baseUrl

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
  assert.equal(await page.getByRole('switch', { name: /显示空分组与空看板列/ }).count(), 1)
  const recentTrades = page.getByRole('button', { name: '最近交易', exact: true })
  assert.equal(await recentTrades.count(), 1)
  assert.equal(await recentTrades.getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '升序', exact: true }).click()
  assert.equal(
    await page.getByText('按开仓时间，旧记录在前', { exact: true }).count(),
    1,
  )
  assert.equal(await page.getByRole('heading', { name: '排序方向', exact: true }).count(), 1)

  await page.evaluate(() => {
    history.pushState({}, '', '/list')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.getByRole('button', { name: '日志选项' }).click()
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
  await page.getByRole('button', { name: '日志选项' }).click()
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
    await page.getByRole('button', { name: '盈亏表现', exact: true }).getAttribute('aria-pressed'),
    'true',
  )

  assert.equal(await page.getByText('按盈亏金额，从低到高', { exact: true }).count(), 1)
  console.log('PASS: display settings and menu expose persistent two-way sorting')
} finally {
  await browser?.close()
  await server.close()
}

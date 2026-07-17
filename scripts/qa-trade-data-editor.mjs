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
  await page.getByRole('button', { name: '创建交易', exact: true }).click()
  await page.getByRole('button', { name: '打开交易属性', exact: true }).click()

  const tradeDataSection = page.locator('.dv-section').filter({
    has: page.locator('.dv-section-head', { hasText: '交易数据' }),
  })
  const dataLabels = await tradeDataSection.locator('.dv-datarow-label').allTextContents()
  assert.ok(!dataLabels.includes('入场'), 'trade detail no longer exposes entry price')
  assert.ok(!dataLabels.includes('出场'), 'trade detail no longer exposes exit price')

  assert.equal(await page.locator('.dv-section-head', { hasText: /^项目$/ }).count(), 0, 'strategy section is not labelled as project')
  assert.equal(await page.locator('.dv-section-head', { hasText: /^策略$/ }).count(), 1, 'strategy section uses the strategy label')

  const openedAtRow = page.getByRole('button', { name: /^开仓 / })
  await openedAtRow.hover()
  await page.waitForTimeout(250)
  assert.equal(await page.getByRole('tooltip').count(), 0, 'date hover preview has been removed')
  await openedAtRow.click()
  const openedAtInput = page.getByRole('textbox', { name: '开仓', exact: true })
  assert.ok((await openedAtInput.boundingBox())?.height >= 44, 'date editor keeps a 44px mobile target')
  console.log('PASS: trade detail hides prices and hover previews while keeping inline date editing')
} finally {
  await browser?.close()
  await server.close()
}

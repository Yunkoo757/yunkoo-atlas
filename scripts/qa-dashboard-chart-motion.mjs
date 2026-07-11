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

  const createClosedTrade = async (status, pnl) => {
    await page.goto(new URL('/list', baseUrl).href)
    await page.getByRole('heading', { name: '交易日志', exact: true }).waitFor()
    await page.keyboard.press('n')
    await page.getByRole('dialog', { name: '新建交易', exact: true }).waitFor()
    await page.getByRole('button', { name: '创建交易', exact: true }).click()
    await page.getByRole('button', { name: '打开交易属性', exact: true }).click()
    await page.getByRole('button', { name: '状态 计划中', exact: true }).click()
    await page.getByRole('menuitemradio', { name: status, exact: true }).click()
    await page.getByRole('button', { name: /^盈亏 / }).click()
    const pnlInput = page.getByRole('spinbutton', { name: '盈亏', exact: true })
    await pnlInput.fill(String(pnl))
    await pnlInput.press('Enter')
    await page.waitForTimeout(400)
  }

  await createClosedTrade('盈利', 10)
  await createClosedTrade('亏损', -5)
  await page.goto(new URL('/dashboard', baseUrl).href)

  const area = page.locator('.recharts-area')
  await area.waitFor()
  assert.equal(await area.locator('.recharts-area-dot').count(), 2)
  assert.equal(await area.locator('[clip-path]').count(), 0)
  assert.ok(await page.locator('.recharts-rectangle').count(), 'R distribution bars render immediately')
  console.log('PASS: dashboard charts render complete values on the first frame')
} finally {
  await browser?.close()
  await server.close()
}

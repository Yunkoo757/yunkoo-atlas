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

  await page.getByRole('button', { name: '入场 0', exact: true }).click()
  const entryInput = page.getByRole('spinbutton', { name: '入场', exact: true })
  assert.ok((await entryInput.boundingBox())?.height >= 44, 'entry editor keeps a 44px mobile target')
  await entryInput.press('Escape')

  await page.getByRole('button', { name: /^开仓 / }).click()
  const openedAtInput = page.getByRole('textbox', { name: '开仓', exact: true })
  assert.ok((await openedAtInput.boundingBox())?.height >= 44, 'date editor keeps a 44px mobile target')
  console.log('PASS: trade data editors expose field names and mobile touch targets')
} finally {
  await browser?.close()
  await server.close()
}

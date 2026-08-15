import { createServer } from 'vite'
import { chromium } from 'playwright'

const server = await createServer({ server: { host: '127.0.0.1', port: 4191 } })
await server.listen()
const browser = await chromium.launch({ headless: true })

async function expectRoute(page, pathname, search = '') {
  await page.waitForFunction((expected) => document.querySelector('[data-keyboard-route]')?.textContent === expected, pathname)
  const expectedHash = `#${pathname}${search}`
  if (new URL(page.url()).hash !== expectedHash) throw new Error(`键盘路由 URL 不正确：期望 ${expectedHash}，实际 ${new URL(page.url()).hash}`)
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const diagnostics = []
  page.on('pageerror', (error) => diagnostics.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') diagnostics.push(message.text()) })
  await page.goto('http://127.0.0.1:4191/src/views/LiveArchiveKeyboard.fixture.html')
  await expectRoute(page, '/dashboard')

  await page.locator('.db-live-link').focus()
  await page.keyboard.press('Enter')
  await expectRoute(page, '/live-history')

  await page.getByRole('tab', { name: '关联案例' }).focus()
  await page.keyboard.press('Enter')
  await expectRoute(page, '/live-history', '?view=cases')
  await page.getByRole('tab', { name: '错题' }).focus()
  await page.keyboard.press('Enter')
  await page.getByText('CASE-KEYBOARD-HISTORY').waitFor()

  await page.getByRole('tab', { name: '实盘记录' }).focus()
  await page.keyboard.press('Enter')
  await expectRoute(page, '/live-history')

  if (diagnostics.length) throw new Error(`键盘验收出现浏览器错误：${diagnostics.join(' | ')}`)
  console.log('PASS historical live keyboard: dashboard → cases → mistakes → trades @1280x900')
} finally {
  await browser.close()
  await server.close()
}

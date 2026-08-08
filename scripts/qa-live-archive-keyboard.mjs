import { createServer } from 'vite'
import { chromium } from 'playwright'

const server = await createServer({ server: { host: '127.0.0.1', port: 4191 } })
await server.listen()
const browser = await chromium.launch({ headless: true })

async function expectRoute(page, route) {
  await page.waitForFunction((expected) => document.querySelector('[data-keyboard-route]')?.textContent === expected, route)
  if (new URL(page.url()).hash !== `#${route}`) throw new Error(`键盘路由 URL 不正确：期望 #${route}，实际 ${new URL(page.url()).hash}`)
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
  await expectRoute(page, '/live-archive')

  await page.locator('[data-archive-detail-link]').focus()
  await page.keyboard.press('Enter')
  await expectRoute(page, '/live-archive/keyboard-archive')

  await page.locator('[data-archive-return]').focus()
  await page.keyboard.press('Enter')
  await expectRoute(page, '/live-archive')

  if (diagnostics.length) throw new Error(`键盘验收出现浏览器错误：${diagnostics.join(' | ')}`)
  console.log('PASS live archive trusted keyboard: dashboard → archive → detail → archive @1280x900')
} finally {
  await browser.close()
  await server.close()
}

// 用 Playwright 把本地 app 各页面截图到 img/mine/，供视觉自查与对齐。
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5180'
const OUT = 'img/mine'
mkdirSync(OUT, { recursive: true })

const pages = [
  { path: '/list', name: 'list' },
  { path: '/board', name: 'board' },
  { path: '/dashboard', name: 'dashboard' },
  { path: '/trade/1', name: 'detail' },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
})
const page = await ctx.newPage()

for (const p of pages) {
  await page.goto(BASE + p.path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${p.name}.png` })
  console.log('shot:', p.name)
}

// 命令面板
await page.goto(BASE + '/list', { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.keyboard.press('Control+k')
await page.waitForTimeout(350)
await page.screenshot({ path: `${OUT}/cmdk.png` })
console.log('shot: cmdk')

// 新建交易表单
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.keyboard.press('c')
await page.waitForTimeout(350)
await page.screenshot({ path: `${OUT}/composer.png` })
console.log('shot: composer')

// 右键上下文菜单
await page.keyboard.press('Escape')
await page.goto(BASE + '/list', { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.click('.lv-row', { button: 'right' })
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/contextmenu.png` })
console.log('shot: contextmenu')

await browser.close()
console.log('done ->', OUT)

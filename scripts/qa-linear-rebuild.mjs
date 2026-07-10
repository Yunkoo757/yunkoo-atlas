import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5181'
const OUT = join(process.cwd(), '.gstack', 'qa-reports', 'linear-rebuild')
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '900x800', width: 900, height: 800 },
]

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: VIEWPORTS[0] })
const page = await context.newPage()
const results = []
const runtimeErrors = []

mkdirSync(OUT, { recursive: true })

page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`)
})

function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function waitForApp() {
  const loading = page.locator('.app-loading')
  if (await loading.count()) {
    await loading.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  }
  await page.locator('.ui-main-frame').waitFor({ state: 'visible', timeout: 10000 })
}

async function open(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
}

async function selectValue(trigger, value) {
  await trigger.click()
  await page.locator(`.ui-select-option[data-value="${value}"]`).click()
}

async function seedData() {
  await open('/today-record')
  await page.locator('body').press('c')
  await selectValue(page.getByRole('combobox', { name: '交易品种' }), 'XAUUSD')
  await page.getByRole('button', { name: '做空' }).click()
  await page.locator('.composer-btn-primary').click()
  await page.waitForURL(/\/trade\/TRD-/)
  const tradeDetailPath = new URL(page.url()).pathname

  await open('/review-cases')
  await page.locator('body').press('c')
  await selectValue(page.getByRole('combobox', { name: '案例记录品种' }), 'BTCUSDT')
  await selectValue(page.getByRole('combobox', { name: '复盘分类' }), 'focus')
  await page.locator('.composer-btn-primary').click()
  await page.waitForURL(/\/trade\/CAS-/)

  await open('/cases')
  await page.locator('.cl-create-btn').filter({ hasText: '新建判例' }).click()
  await page.locator('.ncm').waitFor({ state: 'visible' })
  await page.locator('.ncm-textarea').fill('最终验收判例')
  await page.locator('.ncm-submit').click()
  await page.waitForURL((url) => url.pathname === '/cases' && url.searchParams.has('case'))
  await page.locator('.cd-close').click()

  return tradeDetailPath
}

try {
  const tradeDetailPath = await seedData()
  const routes = [
    { name: 'list', path: '/list', selector: '.list-scroll' },
    { name: 'today-record', path: '/today-record', selector: '.list-scroll' },
    { name: 'review-cases', path: '/review-cases', selector: '.list-scroll' },
    { name: 'trade-detail', path: tradeDetailPath, selector: '.trade-detail-layout' },
    { name: 'dashboard', path: '/dashboard', selector: '.db-scroll' },
    { name: 'cases', path: '/cases', selector: '.cl-content' },
    { name: 'settings-profile', path: '/settings/profile', selector: '.settings-panel' },
  ]

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const route of routes) {
      await open(route.path)
      await page.locator(route.selector).waitFor({ state: 'visible', timeout: 10000 })

      const geometry = await page.evaluate(() => {
        const frame = document.querySelector('.ui-main-frame')
        const rect = frame?.getBoundingClientRect()
        const visibleButtons = [...document.querySelectorAll('button')].filter((button) => {
          const buttonRect = button.getBoundingClientRect()
          return buttonRect.width > 0 && buttonRect.height > 0
        })
        const unnamedButtons = visibleButtons
          .filter((button) => {
            const name = [
              button.textContent?.trim(),
              button.getAttribute('aria-label'),
              button.getAttribute('title'),
            ].find(Boolean)
            return !name
          })
          .map((button) => button.className || '<button>')
        return {
          documentOverflow:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
          frameVisible: Boolean(rect && rect.width > 240 && rect.height > 100),
          frameInsideViewport: Boolean(
            rect && rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1,
          ),
          unnamedButtons,
        }
      })

      const pass =
        !geometry.documentOverflow &&
        geometry.frameVisible &&
        geometry.frameInsideViewport &&
        geometry.unnamedButtons.length === 0
      record(
        `${viewport.name} ${route.name}`,
        pass,
        pass ? '布局与按钮命名通过' : JSON.stringify(geometry),
      )
      await page.screenshot({
        path: join(OUT, `${viewport.name}-${route.name}.png`),
        fullPage: false,
      })
    }
  }

  record(
    '最终基准无页面或控制台错误',
    runtimeErrors.length === 0,
    runtimeErrors.join(' | ') || 'clean',
  )
} catch (error) {
  record('最终 QA 脚本完成', false, String(error))
} finally {
  await browser.close()
}

const passed = results.filter((result) => result.pass).length
console.log(`\nLinear 最终 QA：${passed}/${results.length}`)
process.exit(results.every((result) => result.pass) ? 0 : 1)

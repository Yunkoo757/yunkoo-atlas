import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5181'
const OUT = join(process.cwd(), '.gstack', 'qa-reports', 'linear-rebuild')
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1180x800', width: 1180, height: 800 },
  { name: '900x800', width: 900, height: 800 },
]

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: VIEWPORTS[0] })
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
})
let page = await context.newPage()
const results = []
const runtimeErrors = []

mkdirSync(OUT, { recursive: true })

function trackRuntimeErrors(targetPage) {
  targetPage.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`))
  targetPage.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`)
  })
}

trackRuntimeErrors(page)

function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function waitForApp() {
  const loading = page.locator('.app-loading')
  if (await loading.count()) {
    await loading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  }
  await page.locator('.ui-main-frame').waitFor({ state: 'visible', timeout: 30000 })
}

async function open(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
}

async function selectValue(trigger, value) {
  await trigger.click()
  await page.locator(`.ui-select-option[data-value="${value}"]`).click()
}

async function assertPersistedDetail(expectedSymbol) {
  await page.locator('.trade-detail-layout').waitFor({ state: 'visible', timeout: 10000 })
  const persistedPath = new URL(page.url()).pathname
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForApp()
  if (new URL(page.url()).pathname !== persistedPath) {
    throw new Error(`重载后记录路由改变：${persistedPath} → ${new URL(page.url()).pathname}`)
  }
  await page.locator('.trade-detail-layout').waitFor({ state: 'visible', timeout: 10000 })
  const title = page.locator('.dv-title')
  await title.waitFor({ state: 'visible', timeout: 10000 })
  const titleText = (await title.innerText()).trim()
  if (!titleText.includes(expectedSymbol)) {
    throw new Error(`重载后的详情标题未包含 ${expectedSymbol}：${titleText}`)
  }
}

async function seedData() {
  await open('/today-record')
  await page.locator('body').press('n')
  await selectValue(page.getByRole('combobox', { name: '交易品种' }), 'XAUUSD')
  await page.getByRole('button', { name: '做空' }).click()
  await page.locator('.composer-btn-primary').click()
  await page.waitForURL(/\/trade\/TRD-/)
  await assertPersistedDetail('XAUUSD')
  const tradeDetailPath = new URL(page.url()).pathname

  await open('/review-cases')
  await page.locator('body').press('Shift+N')
  await selectValue(page.getByRole('combobox', { name: '案例记录品种' }), 'BTCUSDT')
  await selectValue(page.getByRole('combobox', { name: '案例类型' }), 'mistake')
  await page.locator('.composer-btn-primary').click()
  await page.waitForURL(/\/trade\/CAS-/)
  await assertPersistedDetail('BTCUSDT')

  return tradeDetailPath
}

try {
  const tradeDetailPath = await seedData()
  const routes = [
    { name: 'list', path: '/list', selector: '.list-scroll' },
    { name: 'today-record', path: '/today-record', selector: '.today-workspace-scroll' },
    { name: 'review-cases', path: '/review-cases', selector: '.list-scroll' },
    { name: 'trade-detail', path: tradeDetailPath, selector: '.trade-detail-layout' },
    { name: 'dashboard', path: '/dashboard', selector: '.db-scroll' },
    { name: 'settings-profile', path: '/settings/profile', selector: '.settings-panel' },
  ]

  for (const viewport of VIEWPORTS) {
    await page.close()
    page = await context.newPage()
    trackRuntimeErrors(page)
    for (const route of routes) {
      const routePage = page
      await routePage.setViewportSize({ width: viewport.width, height: viewport.height })
      await routePage.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' })
      const loading = routePage.locator('.app-loading')
      if (await loading.count()) {
        await loading.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
      }
      await routePage.locator('.ui-main-frame').waitFor({ state: 'visible', timeout: 10000 })
      try {
        await routePage.locator(route.selector).waitFor({ state: 'visible', timeout: 10000 })
      } catch (error) {
        const bodyText = await routePage.locator('body').innerText().catch(() => '')
        throw new Error(
          `${viewport.name} ${route.name} 未出现 ${route.selector}；` +
            `url=${routePage.url()}；body=${bodyText.trim().slice(0, 240)}；${String(error)}`,
        )
      }

      const geometry = await routePage.evaluate(() => {
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
        const clippedStrategyLabels = [...document.querySelectorAll(
          '.trade-row-strategy .strategy-label > span:last-child',
        )]
          .filter((label) => label.offsetParent !== null && label.scrollWidth > label.clientWidth + 1)
          .map((label) => label.textContent?.trim() ?? '')
        const unexpectedFontFamilies = [...document.querySelectorAll('body *')]
          .filter((element) => {
            if (!(element instanceof HTMLElement) || element.offsetParent === null) return false
            return [...element.childNodes].some(
              (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
            )
          })
          .map((element) => getComputedStyle(element).fontFamily)
          .filter(
            (fontFamily, index, families) =>
              !fontFamily.includes('Inter Variable') &&
              !fontFamily.includes('JetBrains Mono') &&
              families.indexOf(fontFamily) === index,
          )
        return {
          documentOverflow:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
          frameVisible: Boolean(rect && rect.width > 240 && rect.height > 100),
          frameInsideViewport: Boolean(
            rect && rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1,
          ),
          unnamedButtons,
          clippedStrategyLabels,
          unexpectedFontFamilies,
        }
      })

      const pass =
        !geometry.documentOverflow &&
        geometry.frameVisible &&
        geometry.frameInsideViewport &&
        geometry.unnamedButtons.length === 0 &&
        geometry.clippedStrategyLabels.length === 0 &&
        geometry.unexpectedFontFamilies.length === 0
      record(
        `${viewport.name} ${route.name}`,
        pass,
        pass ? '布局与按钮命名通过' : JSON.stringify(geometry),
      )
      await routePage.screenshot({
        path: join(OUT, `${viewport.name}-${route.name}.png`),
        fullPage: false,
      })
    }
  }

  await page.close()
  page = await context.newPage()
  trackRuntimeErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open('/list')
  await page.locator('body').press('n')
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10000 })
  const reducedMotionOffenders = await page.evaluate(() => {
    const durationToMs = (value) => {
      const duration = Number.parseFloat(value)
      if (!Number.isFinite(duration)) return 0
      return value.trim().endsWith('ms') ? duration : duration * 1000
    }
    return [...document.querySelectorAll('*')]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
      .flatMap((element) => {
        const style = getComputedStyle(element)
        const animationMs = Math.max(...style.animationDuration.split(',').map(durationToMs))
        const transitionMs = Math.max(...style.transitionDuration.split(',').map(durationToMs))
        return animationMs > 1 || transitionMs > 1
          ? [{ className: element.className, animationMs, transitionMs }]
          : []
      })
      .slice(0, 10)
  })
  record(
    '减弱动效模式压制非必要动画与过渡',
    reducedMotionOffenders.length === 0,
    reducedMotionOffenders.length === 0 ? 'clean' : JSON.stringify(reducedMotionOffenders),
  )
  await page.keyboard.press('Escape')

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

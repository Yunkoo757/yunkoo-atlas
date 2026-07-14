import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5173'
const defaultProfile = JSON.parse(
  readFileSync(new URL('../src/config/default-profile.json', import.meta.url), 'utf8'),
)
const seededStrategyId = defaultProfile.strategies[1]?.id
if (!seededStrategyId) throw new Error('缺少默认策略')

mkdirSync(join(process.cwd(), 'qa-screenshots'), { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

async function waitForApp() {
  const loading = page.locator('.app-loading')
  if (await loading.count()) {
    await loading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  }
  await page.locator('.ui-main-frame').waitFor({ state: 'visible', timeout: 30000 })
}

async function selectValue(trigger, value) {
  await trigger.click()
  await page.locator(`.ui-select-option[data-value="${value}"]`).click()
}

await page.goto(`${BASE}/today-record`, { waitUntil: 'domcontentloaded' })
await waitForApp()
await page.locator('body').press('n')
await selectValue(page.getByRole('combobox', { name: '交易品种' }), 'XAUUSD')
await page.getByRole('button', { name: '做空' }).click()
await selectValue(page.getByRole('combobox', { name: '交易策略' }), seededStrategyId)
await page.locator('.composer-btn-primary').click()
await page.waitForURL(/\/trade\/TRD-/)
await page.locator('.trade-detail-layout').waitFor({ state: 'visible', timeout: 10000 })

const more = page.locator('.dv-tb-right').getByRole('button', { name: '更多' })
await more.click()

const menu = page.locator('body > .menu-pop')
await menu.waitFor({ state: 'visible', timeout: 5000 })

const info = await menu.evaluate((el) => {
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  return {
    parent: el.parentElement?.tagName,
    position: style.position,
    visible:
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      rect.width > 0 &&
      rect.height > 0,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    bottom: Math.round(rect.bottom),
    text: el.textContent?.replace(/\s+/g, ' ').trim(),
    inViewport:
      rect.top >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.left >= 0 &&
      rect.right <= window.innerWidth,
  }
})

const layout = await page.evaluate(() => {
  const topbar = document.querySelector('.dv-topbar')
  const menuEl = document.querySelector('body > .menu-pop')
  if (!topbar || !menuEl) return null
  const t = topbar.getBoundingClientRect()
  const m = menuEl.getBoundingClientRect()
  return {
    topbarBottom: Math.round(t.bottom),
    menuTop: Math.round(m.top),
    menuBottom: Math.round(m.bottom),
    menuHeight: Math.round(m.height),
    // 菜单主体应落到顶栏下方；允许与 trigger 有少量重叠，但不能整块被裁在 44px 顶栏内
    extendsPastTopbar: m.bottom > t.bottom + 40,
  }
})

console.log(JSON.stringify({ info, layout }, null, 2))

if (!info.visible) throw new Error('menu not visible')
if (info.parent !== 'BODY') throw new Error(`menu not portaled to body: ${info.parent}`)
if (info.position !== 'fixed') throw new Error(`menu not fixed: ${info.position}`)
if (!layout?.extendsPastTopbar) throw new Error('menu still appears clipped inside topbar')
if (!info.inViewport) throw new Error('menu not fully in viewport')
if (!/编辑交易|复制编号|删除交易/.test(info.text || '')) {
  throw new Error(`menu missing expected items: ${info.text}`)
}

await page.screenshot({ path: 'qa-screenshots/fix-detail-more-menu.png' })
console.log('PASS detail more menu visible via portal')
await browser.close()

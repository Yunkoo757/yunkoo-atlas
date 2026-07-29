import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const VIEWPORT = { width: 375, height: 812 }
const FIXTURE_PATH = '/src/views/MissedOpportunitiesView.browser.test.html?visual=mobile'

const server = await createServer({
  configFile: 'vite.config.ts',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, open: false },
})

let browser

function watchDiagnostics(page) {
  const diagnostics = []
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`)
  })
  return diagnostics
}

async function openFixture(baseUrl) {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 375, height: 812 })
  const diagnostics = watchDiagnostics(page)
  await page.goto(new URL(FIXTURE_PATH, baseUrl).href)
  await page.waitForFunction(() => '__missedOpportunitiesBrowserTest' in window)
  await page.evaluate(() => window.__missedOpportunitiesBrowserTest)
  return { page, diagnostics }
}

async function activateWithTabAndEnter(page, locator, message) {
  await locator.scrollIntoViewIfNeeded()
  await locator.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  assert.equal(await locator.evaluate((element) => document.activeElement === element), true, `${message}：Tab 未到达目标`)
  await page.keyboard.press('Enter')
}

async function waitForRouterLocation(page, expected) {
  await page.locator('[data-router-location]').filter({ hasText: expected }).waitFor()
  assert.equal(await page.locator('[data-router-location]').textContent(), expected)
}

async function scrollResultsToBottom(page) {
  await page.locator('.missed-content').evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll'))
  })
  await page.locator('[data-trade-id="mobile-last"]').waitFor()
  await page.waitForTimeout(100)
}

async function assertRowsDoNotOverlap(page, phase) {
  const rows = await page.locator('.missed-row').evaluateAll((elements) => elements
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.dataset.tradeId,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      }
    })
    .filter((rect) => rect.height > 0)
    .sort((left, right) => left.top - right.top))
  assert.ok(rows.length > 1, `${phase}：至少需要两个真实移动行用于重叠检查`)
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]
    const current = rows[index]
    assert.ok(
      previous.bottom <= current.top + 0.5,
      `${phase}：移动行 ${previous.id} 与 ${current.id} 发生重叠`,
    )
  }
}

try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  assert.ok(baseUrl, 'Vite test server did not expose a local URL')
  browser = await chromium.launch({ headless: true })

  const layoutFixture = await openFixture(baseUrl)
  try {
    const { page } = layoutFixture
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      mobileMedia: window.matchMedia('(max-width: 768px)').matches,
      documentWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    }))
    assert.deepEqual(
      { width: viewport.width, height: viewport.height },
      VIEWPORT,
      'QA 必须运行在真实 375×812 viewport',
    )
    assert.equal(viewport.mobileMedia, true, '375px 必须命中 <=768px 移动布局')
    assert.ok(viewport.documentWidth <= viewport.documentClientWidth, '375px document 不得横向溢出')
    assert.ok(viewport.bodyWidth <= viewport.bodyClientWidth, '375px body 不得横向溢出')

    await assertRowsDoNotOverlap(page, '列表顶部')
    await scrollResultsToBottom(page)
    await assertRowsDoNotOverlap(page, '列表底部')

    const menuButton = page.getByRole('button', { name: /更多.*案例/ }).first()
    await menuButton.waitFor()
    const menuRect = await menuButton.boundingBox()
    assert.ok(menuRect, '合并项移动菜单按钮不可见')
    assert.ok(menuRect.width >= 44, '合并项菜单命中区宽度不足 44px')
    assert.ok(menuRect.height >= 44, '合并项菜单命中区高度不足 44px')

    const lastAndNavigation = await page.evaluate(() => {
      const last = document.querySelector('[data-trade-id="mobile-last"]')
      const navigation = document.querySelector('.mobile-navigation')
      if (!last || !navigation) return null
      const lastRect = last.getBoundingClientRect()
      const navigationRect = navigation.getBoundingClientRect()
      return {
        lastBottom: lastRect.bottom,
        navigationTop: navigationRect.top,
      }
    })
    assert.ok(lastAndNavigation, '移动 fixture 缺少最后一项或底导航')
    assert.ok(
      lastAndNavigation.lastBottom <= lastAndNavigation.navigationTop + 1,
      '最后一项不得被底导航遮挡',
    )
    await page.waitForTimeout(100)
    assert.deepEqual(layoutFixture.diagnostics, [], '375×812 布局 QA 不得产生浏览器错误')
  } finally {
    await layoutFixture.page.close()
  }

  const keyboardFixture = await openFixture(baseUrl)
  try {
    const { page } = keyboardFixture
    const filter = page.getByRole('button', { name: '筛选错过机会' })
    await activateWithTabAndEnter(page, filter, '筛选器开启')
    await page.getByRole('dialog', { name: '错过机会筛选' }).waitFor()
    await activateWithTabAndEnter(page, filter, '筛选器关闭')

    const paperScope = page.locator('.missed-scope-actions button').filter({ hasText: /^模拟盘/ })
    await activateWithTabAndEnter(page, paperScope, '来源关闭动作')
    assert.equal(await paperScope.getAttribute('aria-pressed'), 'false', '键盘关闭来源未更新 aria-pressed')
    await activateWithTabAndEnter(page, paperScope, '来源恢复动作')
    assert.equal(await paperScope.getAttribute('aria-pressed'), 'true', '键盘恢复来源未更新 aria-pressed')

    const ordinaryAction = page.locator('[data-trade-id="filler-17"] [data-trade-primary-action]')
    await activateWithTabAndEnter(page, ordinaryAction, '普通项打开动作')
    await waitForRouterLocation(page, '/trade/FILLER-17')
    const ordinaryBack = page.getByRole('link', { name: '返回错过的机会' })
    await activateWithTabAndEnter(page, ordinaryBack, '普通项详情返回')
    await waitForRouterLocation(page, '/missed')
    await page.waitForFunction(() => document.activeElement?.closest('[data-trade-id]')?.getAttribute('data-trade-id') === 'filler-17')

    await scrollResultsToBottom(page)
    let mobileMenu = page.locator('[data-trade-id="live-root"]')
      .getByRole('button', { name: /更多.*案例/ })
    await activateWithTabAndEnter(page, mobileMenu, '合并项移动菜单')
    const sourceMenuItem = page.getByRole('menuitem', { name: '打开原始记录', exact: true })
    await activateWithTabAndEnter(page, sourceMenuItem, '移动菜单原始记录动作')
    await waitForRouterLocation(page, '/trade/LIVE-001')
    await activateWithTabAndEnter(page, page.getByRole('link', { name: '返回错过的机会' }), '原始记录详情返回')
    await waitForRouterLocation(page, '/missed')
    await page.waitForFunction(() => {
      const active = document.activeElement
      const row = active?.closest('[data-trade-id="live-root"]')
      return Boolean(row && active?.matches('button[aria-label*="更多"][aria-label*="案例"]'))
    })
    const restoredFocus = await page.evaluate(() => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement)) return null
      const rect = active.getBoundingClientRect()
      return {
        display: getComputedStyle(active).display,
        width: rect.width,
        height: rect.height,
        rectCount: active.getClientRects().length,
      }
    })
    assert.ok(restoredFocus, '移动端详情返回未恢复动作焦点')
    assert.notEqual(restoredFocus.display, 'none', '移动端详情返回不得聚焦 display:none 桌面按钮')
    assert.ok(restoredFocus.rectCount > 0 && restoredFocus.width >= 44 && restoredFocus.height >= 44, '移动端详情返回必须聚焦可见 44×44 菜单')

    mobileMenu = page.locator('[data-trade-id="live-root"]')
      .getByRole('button', { name: /更多.*案例/ })
    await activateWithTabAndEnter(page, mobileMenu, '合并项案例菜单')
    const caseMenuItem = page.getByRole('menuitem', { name: '打开案例 CAS-LINK-1', exact: true })
    await activateWithTabAndEnter(page, caseMenuItem, '移动菜单案例动作')
    await waitForRouterLocation(page, '/trade/CAS-LINK-1')
    await activateWithTabAndEnter(page, page.getByRole('link', { name: '返回错过的机会' }), '案例详情返回')
    await waitForRouterLocation(page, '/missed')
    await page.waitForFunction(() => document.activeElement?.closest('[data-trade-id]')?.getAttribute('data-trade-id') === 'live-root')
    await page.waitForTimeout(100)
    assert.deepEqual(keyboardFixture.diagnostics, [], '键盘与回源 QA 不得产生浏览器错误')
  } finally {
    await keyboardFixture.page.close()
  }

  console.log('PASS: missed opportunities full flow QA at 375×812')
} finally {
  await browser?.close()
  await server.close()
}

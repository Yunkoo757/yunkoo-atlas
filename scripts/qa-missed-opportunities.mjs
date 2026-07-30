import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide', width: 1920, height: 1080 },
]
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

async function openFixture(baseUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  })
  const page = await context.newPage()
  const diagnostics = watchDiagnostics(page)
  await page.goto(new URL(FIXTURE_PATH, baseUrl).href)
  await page.waitForFunction(() => '__missedOpportunitiesBrowserTest' in window)
  await page.evaluate(() => window.__missedOpportunitiesBrowserTest)
  return { context, page, diagnostics }
}

async function assertNoHorizontalOverflow(page, viewport) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }))
  assert.ok(metrics.documentWidth <= metrics.documentClientWidth, `${viewport.name} document 不得横向溢出`)
  assert.ok(metrics.bodyWidth <= metrics.bodyClientWidth, `${viewport.name} body 不得横向溢出`)
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

async function assertResponsiveLayout(page, viewport) {
  const expectedViewport = { width: viewport.width, height: viewport.height }
  assert.deepEqual(
    await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
    expectedViewport,
    `${viewport.name} QA 必须运行在真实 ${viewport.width}×${viewport.height} viewport`,
  )
  assert.equal(
    await page.evaluate(() => window.matchMedia('(max-width: 768px)').matches),
    viewport.width <= 768,
    `${viewport.name} 响应式媒体查询状态不准确`,
  )
  await assertNoHorizontalOverflow(page, viewport)

  const toolbar = page.locator('.missed-view > .ui-filter-shell .ui-filter-bar')
  const scope = page.getByRole('button', { name: '管理包含范围' })
  const filter = page.getByRole('button', { name: '筛选错过机会' })
  await toolbar.waitFor()
  await scope.waitFor()
  await filter.waitFor()
  assert.equal(await scope.isVisible(), true, `${viewport.name} 范围入口必须可见`)
  assert.equal(await filter.isVisible(), true, `${viewport.name} 筛选入口必须可见`)

  const toolbarMetrics = await toolbar.evaluate((element) => {
    const style = getComputedStyle(element)
    const barRect = element.getBoundingClientRect()
    const actions = element.querySelector('.ui-filter-actions')?.getBoundingClientRect()
    const activeFilters = element.querySelector('.ui-active-filters')
    const activeStyle = activeFilters ? getComputedStyle(activeFilters) : null
    const visibleChildren = [...element.children]
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
    return {
      height: barRect.height,
      flexWrap: style.flexWrap,
      overflowX: style.overflowX,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      actionsInside: Boolean(actions && actions.left >= barRect.left && actions.right <= barRect.right + 0.5),
      oneRow: visibleChildren.every((rect) => rect.top >= barRect.top - 0.5 && rect.bottom <= barRect.bottom + 0.5),
      activeFiltersOverflowX: activeStyle?.overflowX,
    }
  })
  assert.equal(toolbarMetrics.flexWrap, 'nowrap', `${viewport.name} 工具栏不得换行`)
  assert.equal(toolbarMetrics.overflowX, 'visible', `${viewport.name} 工具栏自身不得横向滚动`)
  assert.equal(toolbarMetrics.activeFiltersOverflowX, 'auto', `${viewport.name} 只能由当前筛选区横向滚动`)
  assert.equal(toolbarMetrics.actionsInside, true, `${viewport.name} 工具栏动作不得被挤出屏幕`)
  assert.equal(toolbarMetrics.oneRow, true, `${viewport.name} 工具栏必须保持单行`)
  const expectedPadding = viewport.width <= 768 ? 12 : 16
  assert.equal(toolbarMetrics.paddingLeft, expectedPadding, `${viewport.name} 工具栏左内边距不准确`)
  assert.equal(toolbarMetrics.paddingRight, expectedPadding, `${viewport.name} 工具栏右内边距不准确`)
  if (viewport.width <= 768) {
    assert.ok(toolbarMetrics.height >= 56, `${viewport.name} 工具栏高度不得低于 56px`)
  }

  const contentMetrics = await page.locator('.missed-content').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      width: rect.width,
      height: rect.height,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }
  })
  assert.ok(contentMetrics.width > 0 && contentMetrics.height > 0, `${viewport.name} 列表区域必须稳定可见`)
  assert.ok(contentMetrics.scrollHeight >= contentMetrics.clientHeight, `${viewport.name} 列表滚动区域尺寸不稳定`)

  const rowHeights = await page.locator('.missed-row').evaluateAll((elements) => elements
    .map((element) => element.getBoundingClientRect().height)
    .filter((height) => height > 0))
  assert.ok(rowHeights.length > 1, `${viewport.name} 必须渲染足量真实列表行`)
  if (viewport.width >= 1280) {
    assert.equal(rowHeights.every((height) => Math.abs(height - 44) <= 0.5), true, `${viewport.name} 行高必须为 44px`)
  } else {
    assert.equal(rowHeights.every((height) => height >= 64 && height <= 72), true, `${viewport.name} 行高必须在 64–72px`)
  }

  if (viewport.width <= 768) {
    for (const [name, trigger] of [['范围', scope], ['筛选', filter]]) {
      const rect = await trigger.boundingBox()
      assert.ok(rect && rect.height >= 44, `${viewport.name} ${name}按钮命中区高度不足 44px`)
    }
  }

  const visibleRowMenus = page.locator('.missed-row-menu button:visible')
  const menuCount = await visibleRowMenus.count()
  assert.ok(menuCount > 0, `${viewport.name} 至少需要一个可见行菜单`)
  for (let index = 0; index < menuCount; index += 1) {
    const accessibleName = await visibleRowMenus.nth(index).getAttribute('aria-label')
    assert.ok(accessibleName?.trim(), `${viewport.name} 第 ${index + 1} 个可见行菜单缺少可访问名称`)
  }
}

try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  assert.ok(baseUrl, 'Vite test server did not expose a local URL')
  browser = await chromium.launch({ headless: true })

  for (const viewport of VIEWPORTS) {
    const layoutFixture = await openFixture(baseUrl, viewport)
    try {
      const { page } = layoutFixture
      await assertResponsiveLayout(page, viewport)
      await assertRowsDoNotOverlap(page, `${viewport.name} 列表顶部`)
      await scrollResultsToBottom(page)
      await assertRowsDoNotOverlap(page, `${viewport.name} 列表底部`)

      if (viewport.width <= 768) {
        const menuButton = page.locator('[data-trade-id="live-root"]')
          .getByRole('button', { name: '更多操作：XAUUSD' })
        const menuRect = await menuButton.boundingBox()
        assert.ok(menuRect, `${viewport.name} 合并项菜单按钮不可见`)
        assert.ok(menuRect.width >= 44, `${viewport.name} 合并项菜单命中区宽度不足 44px`)
        assert.ok(menuRect.height >= 44, `${viewport.name} 合并项菜单命中区高度不足 44px`)
      }

      if (viewport.width <= 768) {
        const lastAndNavigation = await page.evaluate(() => {
          const last = document.querySelector('[data-trade-id="mobile-last"]')
          const navigation = document.querySelector('.mobile-navigation')
          if (!last || !navigation) return null
          const lastRect = last.getBoundingClientRect()
          const navigationRect = navigation.getBoundingClientRect()
          return { lastBottom: lastRect.bottom, navigationTop: navigationRect.top }
        })
        assert.ok(lastAndNavigation, `${viewport.name} fixture 缺少最后一项或底导航`)
        assert.ok(lastAndNavigation.lastBottom <= lastAndNavigation.navigationTop + 1, `${viewport.name} 最后一项不得被底导航遮挡`)
      }
      await page.waitForTimeout(100)
      assert.deepEqual(layoutFixture.diagnostics, [], `${viewport.name} 布局 QA 不得产生浏览器错误`)
    } finally {
      await layoutFixture.context.close()
    }
  }

  const keyboardFixture = await openFixture(baseUrl, VIEWPORTS[0])
  try {
    const { page } = keyboardFixture
    const filter = page.getByRole('button', { name: '筛选错过机会' })
    await activateWithTabAndEnter(page, filter, '筛选器开启')
    await page.getByRole('dialog', { name: '错过机会筛选' }).waitFor()
    await activateWithTabAndEnter(page, filter, '筛选器关闭')

    const scope = page.getByRole('button', { name: '管理包含范围' })
    await activateWithTabAndEnter(page, scope, '范围菜单开启')
    const scopePanel = page.getByRole('menu', { name: '包含范围' })
    await scopePanel.waitFor()
    assert.equal(await scope.getAttribute('aria-expanded'), 'true', '范围打开态缺少 aria-expanded')
    assert.equal(
      await scopePanel.evaluate((panel) => panel.contains(document.activeElement)),
      true,
      '范围菜单打开后必须接收焦点',
    )
    const tradeScope = page.getByRole('menuitemcheckbox', { name: /^交易日志/ })
    assert.equal(await tradeScope.getAttribute('aria-checked'), 'true', '范围选中态缺少 aria-checked')
    await page.keyboard.press('Escape')
    await scopePanel.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '管理包含范围')
    assert.equal(await scope.evaluate((element) => document.activeElement === element), true, 'Escape 关闭后焦点必须返回范围入口')

    await activateWithTabAndEnter(page, scope, '范围菜单重新开启')
    const paperScope = page.getByRole('menuitemcheckbox', { name: /^模拟盘/ })
    await activateWithTabAndEnter(page, paperScope, '来源关闭动作')
    assert.equal(await paperScope.getAttribute('aria-checked'), 'false', '键盘关闭来源未更新 aria-checked')
    await activateWithTabAndEnter(page, paperScope, '来源恢复动作')
    assert.equal(await paperScope.getAttribute('aria-checked'), 'true', '键盘恢复来源未更新 aria-checked')
    await page.keyboard.press('Escape')

    const ordinaryAction = page.locator('[data-trade-id="filler-17"] [data-trade-primary-action]')
    await activateWithTabAndEnter(page, ordinaryAction, '普通项打开动作')
    await waitForRouterLocation(page, '/trade/FILLER-17')
    const ordinaryBack = page.getByRole('link', { name: '返回错过的机会' })
    await activateWithTabAndEnter(page, ordinaryBack, '普通项详情返回')
    await waitForRouterLocation(page, '/missed')
    await page.waitForFunction(() => document.activeElement?.closest('[data-trade-id]')?.getAttribute('data-trade-id') === 'filler-17')

    await scrollResultsToBottom(page)
    let mobileMenu = page.locator('[data-trade-id="live-root"]')
      .getByRole('button', { name: '更多操作：XAUUSD' })
    await activateWithTabAndEnter(page, mobileMenu, '合并项移动菜单')
    const sourceMenuItem = page.getByRole('menuitem', { name: '打开 XAUUSD 原始交易记录', exact: true })
    await activateWithTabAndEnter(page, sourceMenuItem, '移动菜单原始记录动作')
    await waitForRouterLocation(page, '/trade/LIVE-001')
    await activateWithTabAndEnter(page, page.getByRole('link', { name: '返回错过的机会' }), '原始记录详情返回')
    await waitForRouterLocation(page, '/missed')
    await page.waitForFunction(() => {
      const active = document.activeElement
      const row = active?.closest('[data-trade-id="live-root"]')
      return Boolean(row && active?.matches('button[aria-label="更多操作：XAUUSD"]'))
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
      .getByRole('button', { name: '更多操作：XAUUSD' })
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
    await keyboardFixture.context.close()
  }

  console.log('PASS: missed opportunities full flow QA at 375×812, 768×1024, 1280×800 and 1920×1080')
} finally {
  try {
    await browser?.close()
  } finally {
    await server.close()
  }
}

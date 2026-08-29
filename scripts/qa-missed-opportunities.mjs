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

async function openFixture(baseUrl, viewport, options = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
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

async function tabToTarget(page, locator, message, key = 'Tab') {
  await locator.scrollIntoViewIfNeeded()
  await locator.waitFor({ state: 'visible' })
  for (let step = 0; step < 200; step += 1) {
    if (await locator.evaluate((element) => document.activeElement === element)) return
    await page.keyboard.press(key)
  }
  assert.fail(`${message}：自然键盘链未在 200 步内到达目标`)
}

async function activateWithTabAndEnter(page, locator, message, key = 'Tab') {
  await tabToTarget(page, locator, message, key)
  await page.keyboard.press('Enter')
}

async function assertFocused(locator, message) {
  assert.equal(
    await locator.evaluate((element) => document.activeElement === element),
    true,
    message,
  )
}

async function readVisualState(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
    }
  })
}

function assertVisualStateDiffers(actual, baseline, message) {
  assert.notDeepEqual(actual, baseline, message)
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
      `${phase}：移动行 ${previous.id} ${JSON.stringify(previous)} 与 ${current.id} ${JSON.stringify(current)} 发生重叠`,
    )
  }
}

async function assertResultsScrolledToBottom(page, viewport) {
  const metrics = await page.locator('.missed-content').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const lastRow = document.querySelector('[data-trade-id="mobile-last"]')?.getBoundingClientRect()
    return {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      contentTop: rect.top,
      contentBottom: rect.bottom,
      lastRowTop: lastRow?.top,
      lastRowBottom: lastRow?.bottom,
    }
  })
  assert.ok(metrics.scrollTop > 0, `${viewport.name} 长列表滚动到底后必须形成非零滚动位置`)
  assert.ok(
    Math.abs(metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop) <= 1,
    `${viewport.name} 长列表必须真实滚动到底部边界`,
  )
  assert.ok(
    metrics.lastRowTop !== undefined && metrics.lastRowBottom !== undefined,
    `${viewport.name} 长列表底部缺少最后一条真实记录`,
  )
  assert.ok(
    metrics.lastRowTop < metrics.contentBottom
      && metrics.lastRowBottom > metrics.contentTop
      && metrics.lastRowBottom <= metrics.contentBottom + 1,
    `${viewport.name} 最后一条记录必须稳定落在列表可视边界内`,
  )
}

async function assertInteractiveToolbarTargets(page, viewport, toolbar, filter) {
  await filter.click()
  const panel = page.getByRole('dialog', { name: '错过机会筛选' })
  await panel.waitFor()
  const symbol = page.getByRole('combobox', { name: '品种' })
  await symbol.click()
  const symbolOption = page.locator('[role="listbox"][aria-label="品种"] [role="option"][data-value="XAUUSD"]')
  await symbolOption.click()
  const removableChip = page.getByRole('button', { name: '移除 XAUUSD', exact: true })
  await removableChip.waitFor()
  if (await filter.getAttribute('aria-expanded') === 'true') await filter.click()
  await panel.waitFor({ state: 'hidden' })

  const targets = toolbar.locator(
    'button:visible, a[href]:visible, input:not([type="hidden"]):visible, select:visible, [role="button"]:visible',
  )
  const targetRects = await targets.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
      className: element.className,
      width: rect.width,
      height: rect.height,
    }
  }))
  assert.ok(
    targetRects.some((target) => String(target.className).includes('ui-filter-chip')),
    `${viewport.name} 工具栏命中区枚举必须包含可移除筛选 chip`,
  )
  for (const target of targetRects) {
    assert.ok(
      target.width >= 44,
      `${viewport.name} 工具栏交互目标“${target.label}”宽度不足 44px：${target.width}px`,
    )
    assert.ok(
      target.height >= 44,
      `${viewport.name} 工具栏交互目标“${target.label}”高度不足 44px：${target.height}px`,
    )
  }

  await removableChip.click()
  await removableChip.waitFor({ state: 'hidden' })
}

async function assertScopeInteractionStyles(page) {
  const scope = page.getByRole('button', { name: '管理包含范围' })
  const scopePanel = page.getByRole('menu', { name: '包含范围' })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(200)
  const triggerBase = await readVisualState(scope)

  await scope.hover()
  await page.waitForTimeout(200)
  const triggerHover = await readVisualState(scope)
  assertVisualStateDiffers(triggerHover, triggerBase, '范围触发器 hover 必须与默认态可见不同')

  await page.mouse.down()
  await page.waitForTimeout(200)
  const triggerPressed = await readVisualState(scope)
  assertVisualStateDiffers(triggerPressed, triggerBase, '范围触发器 pressed 必须与默认态可见不同')
  await page.mouse.up()
  await scopePanel.waitFor()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(200)
  const triggerOpen = await readVisualState(scope)
  assertVisualStateDiffers(triggerOpen, triggerBase, '范围触发器 open 必须与默认态可见不同')

  await page.keyboard.press('Escape')
  await scopePanel.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '管理包含范围')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await assertFocused(scope, '范围触发器必须能通过自然 Tab 链获得焦点')
  assert.equal(
    await scope.evaluate((element) => element.matches(':focus-visible')),
    true,
    '范围触发器必须呈现 focus-visible 状态',
  )
  await page.waitForTimeout(200)
  const triggerFocus = await readVisualState(scope)
  assertVisualStateDiffers(triggerFocus, triggerBase, '范围触发器 focus-visible 必须与默认态可见不同')

  await page.keyboard.press('Enter')
  await scopePanel.waitFor()
  const tradeScope = page.getByRole('menuitemcheckbox', { name: '交易日志', exact: true })
  const paperScope = page.getByRole('menuitemcheckbox', { name: '模拟盘', exact: true })
  await assertFocused(tradeScope, '范围菜单键盘打开后第一项必须自然获得焦点')
  assert.equal(
    await tradeScope.evaluate((element) => element.matches(':focus-visible')),
    true,
    '范围菜单第一项必须呈现 focus-visible 状态',
  )
  await page.mouse.move(0, 0)
  await page.waitForTimeout(200)
  const optionFocus = await readVisualState(tradeScope)
  const optionBase = await readVisualState(paperScope)
  assertVisualStateDiffers(optionFocus, optionBase, '范围选项 focus-visible 必须与默认态可见不同')

  await paperScope.hover()
  await page.waitForTimeout(200)
  const optionHover = await readVisualState(paperScope)
  assertVisualStateDiffers(optionHover, optionBase, '范围选项 hover 必须与默认态可见不同')

  await page.mouse.down()
  await page.waitForTimeout(200)
  const optionPressed = await readVisualState(paperScope)
  assertVisualStateDiffers(optionPressed, optionBase, '范围选项 pressed 必须与默认态可见不同')
  await page.mouse.up()
  assert.equal(await paperScope.getAttribute('aria-checked'), 'false', '范围选项 pressed 流程未完成真实切换')
  await paperScope.click()
  assert.equal(await paperScope.getAttribute('aria-checked'), 'true', '范围选项样式验证后未恢复来源')
  await page.keyboard.press('Escape')
  await scopePanel.waitFor({ state: 'hidden' })
}

async function assertReducedMotionResult(page) {
  assert.equal(
    await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    true,
    'reducedMotion 浏览器上下文必须真实匹配 prefers-reduced-motion',
  )

  const scope = page.getByRole('button', { name: '管理包含范围' })
  await scope.click()
  const scopePanel = page.getByRole('menu', { name: '包含范围' })
  await scopePanel.waitFor()
  const pageMotion = await page.locator(
    '.missed-scope-trigger, .missed-scope-popover, .missed-row',
  ).evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element)
    const toMilliseconds = (value) => Math.max(...value.split(',').map((part) => {
      const token = part.trim()
      return token.endsWith('ms')
        ? Number.parseFloat(token)
        : Number.parseFloat(token) * 1_000
    }))
    return {
      selector: element.className,
      animationDurationMs: toMilliseconds(style.animationDuration),
      transitionDurationMs: toMilliseconds(style.transitionDuration),
    }
  }))
  for (const motion of pageMotion) {
    assert.ok(
      motion.animationDurationMs <= 0.001,
      `reduced-motion 下 ${motion.selector} 动画必须降为至多 0.001ms`,
    )
    assert.ok(
      motion.transitionDurationMs <= 0.001,
      `reduced-motion 下 ${motion.selector} 过渡必须降为至多 0.001ms`,
    )
  }
  await page.keyboard.press('Escape')
  await scopePanel.waitFor({ state: 'hidden' })

  const rowMenu = page.locator('[data-trade-id="live-root"]')
    .getByRole('button', { name: '更多操作：XAUUSD' })
  await rowMenu.scrollIntoViewIfNeeded()
  await rowMenu.click()
  const genericMenu = page.getByRole('menu').filter({
    has: page.getByRole('menuitem', { name: '打开 XAUUSD 原始交易记录', exact: true }),
  })
  await genericMenu.waitFor()
  const genericMotion = await genericMenu.evaluate((element) => {
    const style = getComputedStyle(element)
    const toMilliseconds = (value) => Math.max(...value.split(',').map((part) => {
      const token = part.trim()
      return token.endsWith('ms')
        ? Number.parseFloat(token)
        : Number.parseFloat(token) * 1_000
    }))
    return {
      animationDurationMs: toMilliseconds(style.animationDuration),
      animationIterationCount: style.animationIterationCount,
      transitionDurationMs: toMilliseconds(style.transitionDuration),
    }
  })
  assert.ok(
    genericMotion.animationDurationMs <= 0.001,
    `reduced-motion 下共享行菜单动画必须降为至多 0.001ms，实测 ${genericMotion.animationDurationMs}ms`,
  )
  assert.equal(genericMotion.animationIterationCount, '1', 'reduced-motion 下共享行菜单动画不得循环')
  assert.ok(
    genericMotion.transitionDurationMs <= 0.001,
    `reduced-motion 下共享行菜单过渡必须降为至多 0.001ms，实测 ${genericMotion.transitionDurationMs}ms`,
  )
  await page.keyboard.press('Escape')
  await genericMenu.waitFor({ state: 'hidden' })
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
    const childCenterLines = visibleChildren.map((rect) => rect.top + rect.height / 2)
    const centerLineSpread = childCenterLines.length > 0
      ? Math.max(...childCenterLines) - Math.min(...childCenterLines)
      : Number.POSITIVE_INFINITY
    return {
      height: barRect.height,
      flexWrap: style.flexWrap,
      overflowX: style.overflowX,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      actionsInside: Boolean(actions && actions.left >= barRect.left && actions.right <= barRect.right + 0.5),
      visibleChildCount: visibleChildren.length,
      centerLineSpread,
      activeFiltersOverflowX: activeStyle?.overflowX,
    }
  })
  assert.equal(toolbarMetrics.flexWrap, 'nowrap', `${viewport.name} 工具栏不得换行`)
  assert.equal(toolbarMetrics.overflowX, 'visible', `${viewport.name} 工具栏自身不得横向滚动`)
  assert.equal(toolbarMetrics.activeFiltersOverflowX, 'auto', `${viewport.name} 只能由当前筛选区横向滚动`)
  assert.equal(toolbarMetrics.actionsInside, true, `${viewport.name} 工具栏动作不得被挤出屏幕`)
  assert.ok(toolbarMetrics.visibleChildCount >= 2, `${viewport.name} 工具栏必须具有可比较的真实子项`)
  assert.ok(
    toolbarMetrics.centerLineSpread <= 0.5,
    `${viewport.name} 工具栏子项必须处于同一行中心线`,
  )
  const expectedPadding = viewport.width <= 768 ? 12 : 16
  assert.equal(toolbarMetrics.paddingLeft, expectedPadding, `${viewport.name} 工具栏左内边距不准确`)
  assert.equal(toolbarMetrics.paddingRight, expectedPadding, `${viewport.name} 工具栏右内边距不准确`)
  if (viewport.width <= 768) {
    assert.ok(toolbarMetrics.height >= 56, `${viewport.name} 工具栏高度不得低于 56px`)
  }

  const contentMetrics = await page.locator('.missed-content').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const firstVisibleRow = [...element.querySelectorAll('.missed-row')]
      .map((row) => row.getBoundingClientRect())
      .find((rowRect) => rowRect.bottom > rect.top && rowRect.top < rect.bottom)
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      firstRowTop: firstVisibleRow?.top,
      firstRowBottom: firstVisibleRow?.bottom,
    }
  })
  assert.ok(
    contentMetrics.width > 0 && contentMetrics.height >= viewport.height * 0.5,
    `${viewport.name} 列表区域必须稳定占据至少半个 viewport 高度`,
  )
  assert.ok(
    contentMetrics.left >= -0.5 && contentMetrics.right <= contentMetrics.viewportWidth + 0.5
      && contentMetrics.top >= -0.5 && contentMetrics.bottom <= contentMetrics.viewportHeight + 0.5,
    `${viewport.name} 列表区域必须完整落在 viewport 边界内`,
  )
  assert.equal(contentMetrics.scrollTop, 0, `${viewport.name} 列表初始位置必须稳定在顶部`)
  assert.ok(contentMetrics.scrollHeight > contentMetrics.clientHeight, `${viewport.name} 足量长列表必须形成真实纵向滚动`)
  assert.ok(
    contentMetrics.firstRowTop !== undefined && contentMetrics.firstRowBottom !== undefined
      && contentMetrics.firstRowTop >= contentMetrics.top - 0.5
      && contentMetrics.firstRowTop < contentMetrics.bottom
      && contentMetrics.firstRowBottom > contentMetrics.top,
    `${viewport.name} 首条可见记录必须稳定落在列表顶部边界内`,
  )

  const rowHeights = await page.locator('.missed-row').evaluateAll((elements) => elements
    .map((element) => element.getBoundingClientRect().height)
    .filter((height) => height > 0))
  assert.ok(rowHeights.length > 1, `${viewport.name} 必须渲染足量真实列表行`)
  if (viewport.width >= 1280) {
    assert.equal(rowHeights.every((height) => Math.abs(height - 44) <= 0.5), true, `${viewport.name} 行高必须为 44px`)
  } else {
    assert.equal(rowHeights.every((height) => height >= 64 && height <= 72), true, `${viewport.name} 行高必须在 64–72px`)
  }

  for (const [name, trigger] of [['范围', scope], ['筛选', filter]]) {
    const rect = await trigger.boundingBox()
    assert.ok(rect, `${viewport.name} ${name}按钮必须具有真实几何尺寸`)
    const computedHeight = await trigger.evaluate((element) => Number.parseFloat(getComputedStyle(element).height))
    if (viewport.width <= 768) {
      assert.ok(rect.width >= 44, `${viewport.name} ${name}按钮命中区宽度不足 44px`)
      assert.ok(rect.height >= 44, `${viewport.name} ${name}按钮命中区高度不足 44px`)
    } else {
      assert.ok(Math.abs(rect.height - 32) <= 0.5, `${viewport.name} ${name}按钮几何高度必须为 32px`)
      assert.ok(Math.abs(computedHeight - 32) <= 0.5, `${viewport.name} ${name}按钮 computed height 必须为 32px`)
    }
  }

  if (viewport.width <= 768) {
    await scope.click()
    const scopeItems = page.locator('.missed-scope-popover [role="menuitemcheckbox"]')
    await scopeItems.first().waitFor()
    for (const sourceName of ['交易日志', '模拟盘', '案例记录']) {
      assert.equal(
        await page.getByRole('menuitemcheckbox', { name: sourceName, exact: true }).count(),
        1,
        `${viewport.name} 范围选项“${sourceName}”的可访问名称不得包含计数`,
      )
    }
    const scopeItemRects = await scopeItems.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }))
    assert.equal(scopeItemRects.length, 3, `${viewport.name} 范围菜单必须渲染三个来源选项`)
    for (const [index, rect] of scopeItemRects.entries()) {
      assert.ok(rect.width >= 44, `${viewport.name} 范围菜单第 ${index + 1} 项命中区宽度不足 44px：${rect.width}px`)
      assert.ok(rect.height >= 44, `${viewport.name} 范围菜单第 ${index + 1} 项命中区高度不足 44px：${rect.height}px`)
    }
    await page.keyboard.press('Escape')
    await scopeItems.first().waitFor({ state: 'hidden' })
  }

  const visibleRowMenus = page.locator('.missed-row-menu button:visible')
  const menuCount = await visibleRowMenus.count()
  assert.ok(menuCount > 0, `${viewport.name} 至少需要一个可见行菜单`)
  const menuContexts = await visibleRowMenus.evaluateAll((buttons) => buttons.map((button) => {
    const row = button.closest('[data-trade-id]')
    const symbolElement = row?.querySelector('.missed-row-symbol strong')
    return {
      tradeId: row?.getAttribute('data-trade-id') ?? '',
      symbol: symbolElement?.textContent?.trim() ?? '',
      symbolVisible: Boolean(symbolElement && symbolElement.getClientRects().length > 0),
      accessibleName: button.getAttribute('aria-label')?.trim() ?? '',
    }
  }))
  for (const [index, context] of menuContexts.entries()) {
    assert.ok(context.tradeId, `${viewport.name} 第 ${index + 1} 个可见行菜单缺少所属记录`)
    assert.ok(context.symbol && context.symbolVisible, `${viewport.name} 记录 ${context.tradeId} 缺少可见 symbol`)
    assert.ok(
      context.accessibleName.includes(context.symbol),
      `${viewport.name} 记录 ${context.tradeId} 的行菜单名称必须包含 symbol ${context.symbol}`,
    )
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
      await assertResultsScrolledToBottom(page, viewport)

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

  for (const viewport of VIEWPORTS.filter((candidate) => candidate.width <= 768)) {
    const toolbarFixture = await openFixture(baseUrl, viewport)
    try {
      const toolbar = toolbarFixture.page.locator('.missed-view > .ui-filter-shell .ui-filter-bar')
      const filter = toolbarFixture.page.getByRole('button', { name: '筛选错过机会' })
      await assertInteractiveToolbarTargets(toolbarFixture.page, viewport, toolbar, filter)
      assert.deepEqual(
        toolbarFixture.diagnostics,
        [],
        `${viewport.name} 工具栏命中区 QA 不得产生浏览器错误`,
      )
    } finally {
      await toolbarFixture.context.close()
    }
  }

  const reducedMotionFixture = await openFixture(baseUrl, VIEWPORTS[0], { reducedMotion: 'reduce' })
  try {
    await assertReducedMotionResult(reducedMotionFixture.page)
    await reducedMotionFixture.page.waitForTimeout(100)
    assert.deepEqual(
      reducedMotionFixture.diagnostics,
      [],
      'reduced-motion QA 不得产生浏览器错误',
    )
  } finally {
    await reducedMotionFixture.context.close()
  }

  const keyboardFixture = await openFixture(baseUrl, VIEWPORTS[0])
  try {
    const { page } = keyboardFixture
    await assertScopeInteractionStyles(page)
    const filter = page.getByRole('button', { name: '筛选错过机会' })
    await activateWithTabAndEnter(page, filter, '筛选器开启')
    await page.getByRole('dialog', { name: '错过机会筛选' }).waitFor()
    await activateWithTabAndEnter(page, filter, '筛选器关闭')

    const scope = page.getByRole('button', { name: '管理包含范围' })
    await activateWithTabAndEnter(page, scope, '范围菜单开启', 'Shift+Tab')
    const scopePanel = page.getByRole('menu', { name: '包含范围' })
    await scopePanel.waitFor()
    assert.equal(await scope.getAttribute('aria-expanded'), 'true', '范围打开态缺少 aria-expanded')
    assert.equal(
      await scopePanel.evaluate((panel) => panel.contains(document.activeElement)),
      true,
      '范围菜单打开后必须接收焦点',
    )
    const tradeScope = page.getByRole('menuitemcheckbox', { name: '交易日志', exact: true })
    const paperScope = page.getByRole('menuitemcheckbox', { name: '模拟盘', exact: true })
    const caseScope = page.getByRole('menuitemcheckbox', { name: '案例记录', exact: true })
    await assertFocused(tradeScope, '范围菜单打开后交易日志选项必须自然获得焦点')
    assert.equal(await tradeScope.getAttribute('aria-checked'), 'true', '范围选中态缺少 aria-checked')
    assert.equal(await paperScope.count(), 1, '模拟盘范围选项必须使用不含计数的精确可访问名称')
    assert.equal(await caseScope.count(), 1, '案例记录范围选项必须使用不含计数的精确可访问名称')
    await page.keyboard.press('Escape')
    await scopePanel.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '管理包含范围')
    assert.equal(await scope.evaluate((element) => document.activeElement === element), true, 'Escape 关闭后焦点必须返回范围入口')

    await activateWithTabAndEnter(page, scope, '范围菜单重新开启')
    await activateWithTabAndEnter(page, paperScope, '来源关闭动作')
    assert.equal(await paperScope.getAttribute('aria-checked'), 'false', '键盘关闭来源未更新 aria-checked')
    await activateWithTabAndEnter(page, paperScope, '来源恢复动作')
    assert.equal(await paperScope.getAttribute('aria-checked'), 'true', '键盘恢复来源未更新 aria-checked')
    await page.keyboard.press('Escape')

    const ordinaryAction = page.locator('[data-trade-id="filler-17"] [data-trade-primary-action]')
    await activateWithTabAndEnter(page, ordinaryAction, '普通项打开动作')
    await waitForRouterLocation(page, '/trade/FILLER-17')
    const ordinaryBack = page.getByRole('link', { name: '返回错过机会' })
    await activateWithTabAndEnter(page, ordinaryBack, '普通项详情返回')
    await waitForRouterLocation(page, '/missed')
    await page.waitForFunction(() => document.activeElement?.closest('[data-trade-id]')?.getAttribute('data-trade-id') === 'filler-17')

    await scrollResultsToBottom(page)
    let rowMenu = page.locator('[data-trade-id="live-root"]')
      .getByRole('button', { name: '更多操作：XAUUSD' })
    await activateWithTabAndEnter(page, rowMenu, '合并项共享行菜单')
    assert.equal(await rowMenu.getAttribute('aria-haspopup'), 'menu', '共享行菜单真实触发器缺少 aria-haspopup')
    assert.equal(await rowMenu.getAttribute('aria-expanded'), 'true', '共享行菜单真实触发器缺少打开态 aria-expanded')
    const rowMenuId = await rowMenu.getAttribute('aria-controls')
    assert.ok(rowMenuId, '共享行菜单真实触发器缺少 aria-controls')
    const rowMenuPanel = page.locator(`[id=${JSON.stringify(rowMenuId)}]`)
    assert.equal(
      await rowMenuPanel.getAttribute('role'),
      'menu',
      '共享行菜单 aria-controls 未指向实际菜单',
    )
    const sourceMenuItem = page.getByRole('menuitem', { name: '打开 XAUUSD 原始交易记录', exact: true })
    const rowMenuItems = rowMenuPanel.getByRole('menuitem')
    const secondRowMenuItem = rowMenuItems.nth(1)
    const lastRowMenuItem = rowMenuItems.last()
    await assertFocused(sourceMenuItem, '共享行菜单打开后首项必须自然获得焦点')
    await page.keyboard.press('ArrowDown')
    await assertFocused(secondRowMenuItem, '共享行菜单 ArrowDown 必须移动到下一项')
    await page.keyboard.press('End')
    await assertFocused(lastRowMenuItem, '共享行菜单 End 必须移动到末项')
    await page.keyboard.press('Home')
    await assertFocused(sourceMenuItem, '共享行菜单 Home 必须移动到首项')
    await page.keyboard.press('ArrowUp')
    await assertFocused(lastRowMenuItem, '共享行菜单 ArrowUp 必须从首项循环到末项')
    await page.keyboard.press('Escape')
    await rowMenuPanel.waitFor({ state: 'hidden' })
    await assertFocused(rowMenu, '共享行菜单 Escape 必须把焦点还给真实触发器')
    await page.keyboard.press('Enter')
    await assertFocused(sourceMenuItem, '共享行菜单重新打开后首项必须自然获得焦点')
    await page.keyboard.press('Enter')
    await waitForRouterLocation(page, '/trade/LIVE-001')
    await activateWithTabAndEnter(page, page.getByRole('link', { name: '返回错过机会' }), '原始记录详情返回')
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

    rowMenu = page.locator('[data-trade-id="live-root"]')
      .getByRole('button', { name: '更多操作：XAUUSD' })
    await activateWithTabAndEnter(page, rowMenu, '合并项案例共享行菜单')
    const caseMenuItem = page.getByRole('menuitem', { name: '打开案例 CAS-LINK-1', exact: true })
    await assertFocused(sourceMenuItem, '案例共享行菜单打开后首项必须自然获得焦点')
    await tabToTarget(page, caseMenuItem, '案例共享行菜单必须通过 ArrowDown 到达案例动作', 'ArrowDown')
    await page.keyboard.press('Enter')
    await waitForRouterLocation(page, '/trade/CAS-LINK-1')
    await activateWithTabAndEnter(page, page.getByRole('link', { name: '返回错过机会' }), '案例详情返回')
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

import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 41713
const BASE = `http://127.0.0.1:${PORT}`
const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, '')
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const qaStrategies = [
  { id: 'qa-sidebar-primary', name: 'QA 趋势策略', icon: 'target', color: '#5e6ad2' },
  { id: 'qa-sidebar-secondary', name: 'QA 突破策略', icon: 'zap', color: '#26b5ce' },
  { id: 'qa-sidebar-overflow', name: 'QA 区间策略', icon: 'activity', color: '#e0a526' },
]
const [primaryStrategy, secondaryStrategy, overflowStrategy] = qaStrategies.map(
  (strategy) => strategy.name,
)

function startVite() {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return {
    child,
    output: () => output,
    hasReadySignal: () => /Local:\s+http:\/\/127\.0\.0\.1:\d+\//.test(stripAnsi(output)),
  }
}

async function waitForVite(vite) {
  let earlyExit = null
  const handleExit = (code, signal) => { earlyExit = { code, signal } }
  vite.child.once('exit', handleExit)
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (earlyExit) {
      throw new Error(`Vite exited before ready (${earlyExit.signal ?? `code ${earlyExit.code}`}): ${vite.output().trim()}`)
    }
    if (!vite.hasReadySignal()) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      continue
    }
    try {
      const response = await fetch(BASE)
      const body = response.ok ? await response.text() : ''
      if (body.includes('/@vite/client')) {
        vite.child.off('exit', handleExit)
        return
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Vite did not start in time')
}

async function stopVite(vite) {
  if (vite.child.exitCode !== null) return
  const stopped = new Promise((resolve) => vite.child.once('exit', resolve))
  await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 100))])
  if (vite.child.exitCode === null) vite.child.kill()
  await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 1000))])
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fetch(BASE)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite stopped but port ${PORT} remained occupied`)
}

async function verifyExistingViteConflict() {
  const existing = startVite()
  let contender
  try {
    await waitForVite(existing)
    contender = startVite()
    let conflictError = null
    try {
      await waitForVite(contender)
    } catch (error) {
      conflictError = error
    }
    if (!conflictError) throw new Error('QA incorrectly treated the existing Vite as the contender process')
    const message = String(conflictError)
    if (!message.includes('Vite exited before ready') || !message.includes('already in use')) {
      throw conflictError
    }
  } finally {
    if (contender) await stopVite(contender)
    await stopVite(existing)
  }
}

async function expectVisible(locator) {
  await locator.waitFor({ state: 'visible', timeout: 5000 })
}

async function waitForAutoSave(page) {
  await page.waitForFunction(async () => {
    const [{ useSaveStatus }, { hasPendingChanges }] = await Promise.all([
      import('/src/store/saveStatus.ts'),
      import('/src/storage/persist.ts'),
    ])
    return useSaveStatus.getState().status === 'saved' && !hasPendingChanges()
  }, undefined, { timeout: 10_000 })
}

/** 虚拟列表下目标行可能未挂载，先滚动再断言可见 */
async function ensureTradeRowVisible(page, tradeId) {
  const locator = page.locator(`[data-trade-id="${tradeId}"]`)
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false))) {
      return locator.first()
    }
    await page.evaluate(async (id) => {
      const { requestScrollToTrade } = await import('/src/lib/tradeScrollTargets.ts')
      if (requestScrollToTrade(id)) return
      for (const selector of ['.list-scroll', '.bd-col-body']) {
        document.querySelectorAll(selector).forEach((element) => {
          element.scrollTop = element.scrollHeight
        })
      }
    }, tradeId)
    await page.waitForTimeout(40)
  }
  await expectVisible(locator)
  return locator.first()
}

async function expectHidden(locator) {
  await locator.waitFor({ state: 'hidden', timeout: 5000 })
}

async function expectText(locator, expected) {
  await expectVisible(locator)
  const actual = (await locator.textContent()) ?? ''
  if (!expected.test(actual)) throw new Error(`Expected ${expected}, received ${JSON.stringify(actual)}`)
}

async function expectAttribute(locator, name, expected) {
  let actual = await locator.getAttribute(name)
  for (let attempt = 0; actual !== expected && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    actual = await locator.getAttribute(name)
  }
  if (actual !== expected) throw new Error(`Expected ${name}=${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}

function expectEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

async function expectActiveSidebarLabels(page, expected, message) {
  try {
    await page.waitForFunction(
      (labels) => {
        const actual = [...document.querySelectorAll('.sidebar a.sb-item.is-active .sb-item-label')]
          .map((element) => element.textContent?.trim() ?? '')
        return JSON.stringify(actual) === JSON.stringify(labels)
      },
      expected,
      { timeout: 5000 },
    )
  } catch {
    expectEqual(
      await page.locator('.sidebar a.sb-item.is-active .sb-item-label').allTextContents(),
      expected,
      message,
    )
  }
}

async function expectCount(locator, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const actual = await locator.count()
    if (actual === expected) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const actual = await locator.count()
  throw new Error(`Expected count ${expected}, received ${actual}`)
}

async function expectFocused(locator) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected element to be focused')
}

async function expectFocusInside(locator) {
  const inside = await locator.evaluate((element) => element.contains(document.activeElement))
  if (!inside) throw new Error('Expected focus to remain inside modal')
}

async function expectNoHorizontalOverflow(page, locator) {
  const documentWidths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  if (documentWidths.scrollWidth > documentWidths.clientWidth) {
    throw new Error(`Document overflowed horizontally: ${documentWidths.scrollWidth} > ${documentWidths.clientWidth}`)
  }
  if (!locator) return
  const elementWidths = await locator.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))
  if (elementWidths.scrollWidth > elementWidths.clientWidth) {
    throw new Error(`Modal overflowed horizontally: ${elementWidths.scrollWidth} > ${elementWidths.clientWidth}`)
  }
}

async function expectMobileCurrentCount(page, expected) {
  const current = page.locator([
    '.mobile-navigation [aria-current="page"]',
    '.mobile-navigation-overlay:not(.ui-exit-clone) .mobile-navigation-drawer [aria-current="page"]',
  ].join(', '))
  const actual = await current.count()
  if (actual !== expected) {
    const labels = await current.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim()))
    throw new Error(`Expected ${expected} mobile page current, received ${actual}: ${JSON.stringify(labels)}`)
  }
}

async function expectUrl(page, expectedPathAndSearch, message) {
  await page.waitForFunction((expected) => `${location.pathname}${location.search}` === expected, expectedPathAndSearch)
  const actual = await page.evaluate(() => `${location.pathname}${location.search}`)
  if (actual !== expectedPathAndSearch) throw new Error(`${message}: expected ${expectedPathAndSearch}, received ${actual}`)
}

async function expectTradeInScrollViewport(page, tradeId, scrollContract) {
  const contract = typeof scrollContract === 'string'
    ? { containerSelector: scrollContract, intersectWindow: false }
    : scrollContract
  const metrics = await page.locator(`[data-trade-id="${tradeId}"]`).evaluate((element, options) => {
    const target = element.getBoundingClientRect()
    const scroll = element.closest(options.containerSelector)?.getBoundingClientRect()
    if (!scroll) return null
    const visible = options.intersectWindow
      ? {
          top: Math.max(scroll.top, 0),
          right: Math.min(scroll.right, innerWidth),
          bottom: Math.min(scroll.bottom, innerHeight),
          left: Math.max(scroll.left, 0),
        }
      : scroll
    return {
      targetTop: target.top,
      targetRight: target.right,
      targetBottom: target.bottom,
      targetLeft: target.left,
      visibleTop: visible.top,
      visibleRight: visible.right,
      visibleBottom: visible.bottom,
      visibleLeft: visible.left,
    }
  }, contract)
  if (
    !metrics ||
    metrics.targetBottom <= metrics.visibleTop ||
    metrics.targetTop >= metrics.visibleBottom ||
    metrics.targetRight <= metrics.visibleLeft ||
    metrics.targetLeft >= metrics.visibleRight
  ) {
    throw new Error(`${tradeId} was not restored into ${contract.containerSelector} viewport: ${JSON.stringify(metrics)}`)
  }
}

await verifyExistingViteConflict()
const vite = startVite()
let browser

try {
  await waitForVite(vite)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  // 本脚本用 page.goto 反复创建新文档来检查深链接，不是在验证多标签所有权。
  // 显式走受 WEB4 独立覆盖的“无 Web Locks、CAS 保正确性”路径，避免旧文档
  // pagehide 释放锁与新文档 ifAvailable 探测之间的瞬时竞态污染侧栏断言。
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
  })
  const browserProblems = []
  page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error' || /each child.*unique.*key|accessible name/i.test(text)) {
      browserProblems.push(`${message.type()}: ${text}`)
    }
  })
  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  await page.evaluate(async (strategies) => {
    const { useStore } = await import('/src/store/useStore.ts')
    for (const strategy of strategies) useStore.getState().addStrategy(strategy)
  }, qaStrategies)

  expectEqual(
    await page.locator('.sb-primary > a .sb-item-label').allTextContents(),
    ['今日工作台', '随记', '交易日志', '案例记录', '周复盘', '随机复盘', '仪表盘'],
    'Default core modules must preserve their approved order',
  )
  expectEqual(
    await page.locator('.sb-workspace > a .sb-item-label').allTextContents(),
    ['进行中', '星标交易', '错过的机会', '模拟回测'],
    'Default workspace must expose the four system items',
  )

  const tradeNav = page.locator('.sb-primary > a').nth(2)
  await tradeNav.hover()
  await page.waitForTimeout(300)
  expectEqual(
    await page.locator('.shortcut-tooltip-content').count(),
    0,
    'Text navigation must not repeat itself in a shortcut tooltip',
  )
  await page.evaluate(async () => {
    const { useShortcutStore } = await import('/src/store/shortcutStore.ts')
    useShortcutStore.getState().setBinding('nav.list', { key: 'a' })
    useShortcutStore.getState().setBinding('nav.board', { key: 'd' })
  })
  await page.goto(`${BASE}/favorites?symbol=BTCUSDT`, { waitUntil: 'domcontentloaded' })
  await page.locator('.sb-primary > a').first().waitFor({ state: 'visible', timeout: 10000 })
  await page.keyboard.press('a')
  await page.waitForURL((url) => url.pathname === '/list' && url.search === '')
  await page.goto(`${BASE}/active/board?symbol=BTCUSDT`, { waitUntil: 'domcontentloaded' })
  await page.locator('.sb-primary > a').first().waitFor({ state: 'visible', timeout: 10000 })
  await page.keyboard.press('d')
  await page.waitForURL((url) => url.pathname === '/board' && url.search === '')
  await page.evaluate(async () => {
    const { useShortcutStore } = await import('/src/store/shortcutStore.ts')
    useShortcutStore.getState().resetBinding('nav.list')
    useShortcutStore.getState().resetBinding('nav.board')
  })

  await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    useStore.getState().saveTradeView({
      id: 'qa-saved-view',
      name: 'QA 保存视图',
      pathname: '/list',
      search: { status: 'open' },
      pinned: false,
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  const manageButton = page.getByRole('button', { name: '管理我的空间', exact: true })
  await expectAttribute(manageButton, 'aria-expanded', 'false')
  const editorId = await manageButton.getAttribute('aria-controls')
  if (!editorId) throw new Error('Manager opener must expose aria-controls')
  await manageButton.click()
  await expectAttribute(manageButton, 'aria-expanded', 'true')
  const editor = page.getByRole('dialog', { name: '管理我的空间' })
  await expectAttribute(editor, 'id', editorId)
  const editorHeading = editor.getByRole('heading', { name: '管理我的空间' })
  await expectAttribute(editor, 'aria-labelledby', 'sidebar-workspace-editor-title')
  await expectFocused(editorHeading)
  await expectText(page.locator('[data-sidebar-capacity]'), /常驻 \d+ \/ 8/)
  await expectVisible(page.getByRole('button', { name: '添加项目' }))
  await expectVisible(editor.getByRole('heading', { name: '常驻侧栏' }))
  await expectVisible(editor.getByRole('heading', { name: '更多' }))

  const rows = editor.locator('[data-sidebar-item]')
  await expectAttribute(rows.nth(0), 'tabindex', null)
  const originalLabels = await rows.locator('[data-sidebar-item-label]').allTextContents()
  if (originalLabels.length < 2) throw new Error('Expected at least two editable workspace items')

  await rows.nth(0).dragTo(rows.nth(1))
  const draggedLabels = await rows.locator('[data-sidebar-item-label]').allTextContents()
  if (draggedLabels[1] !== originalLabels[0]) throw new Error('Native drag did not move the first item down')
  await page.keyboard.press('Escape')
  await expectCount(editor, 0)
  await expectFocused(manageButton)
  const dailyLabels = await page.locator('.sb-workspace > a .sb-item-label').allTextContents()
  if (dailyLabels[0] !== originalLabels[0]) throw new Error('Escape persisted the draft unexpectedly')

  await manageButton.click()
  await expectVisible(editor)
  // 弹层居中偏左，点 backdrop 左上角避免命中对话框本体
  await page.locator('.sb-workspace-editor-backdrop').click({ position: { x: 8, y: 8 } })
  await expectCount(editor, 0)
  await expectFocused(manageButton)

  await manageButton.click()
  const firstHandle = rows.nth(0).getByRole('button', { name: `排序 ${originalLabels[0]}` })
  const descriptionId = await firstHandle.getAttribute('aria-describedby')
  if (!descriptionId) throw new Error('Sort handle must describe position and shortcuts')
  await expectText(editor.locator(`[id="${descriptionId}"]`), /常驻第 1 项，共 \d+ 项。使用 Alt \+ 上\/下方向键排序/)
  await firstHandle.press('Alt+ArrowDown')
  await expectText(editor.locator('[aria-live="polite"]'), new RegExp(`${originalLabels[0]} 已移动到常驻第 2 项`))
  const keyboardLabels = await rows.locator('[data-sidebar-item-label]').allTextContents()
  if (keyboardLabels.join('|') !== draggedLabels.join('|')) throw new Error('Keyboard and drag ordering diverged')
  const beforeDelete = await rows.evaluateAll((elements) => elements.map((element) => ({
    label: element.querySelector('[data-sidebar-item-label]')?.textContent ?? '',
    placement: element.getAttribute('data-sidebar-placement'),
  })))
  await rows.nth(1).getByRole('button', { name: `排序 ${originalLabels[0]}` }).press('Delete')
  await expectVisible(editor.getByText(/已移除 .* ·/))
  await editor.getByRole('button', { name: '撤销' }).click()
  const afterUndo = await rows.evaluateAll((elements) => elements.map((element) => ({
    label: element.querySelector('[data-sidebar-item-label]')?.textContent ?? '',
    placement: element.getAttribute('data-sidebar-placement'),
  })))
  expectEqual(afterUndo, beforeDelete, 'Undo must restore every label, placement, and position')

  await editor.getByRole('button', { name: '添加项目' }).click()
  await expectVisible(editor.getByRole('heading', { name: '添加项目' }))
  await expectVisible(editor.getByRole('button', { name: '返回管理列表' }))
  const search = editor.getByRole('searchbox', { name: '搜索可添加项目' })
  await search.focus()
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    useStore.getState().setDisplayName('QA 父级重渲染')
  })
  await expectFocused(search)
  for (const group of ['工作区能力', '交易日志', '模拟回测', '案例记录', '策略']) {
    await expectVisible(editor.getByRole('heading', { name: group }))
  }
  const group = (name) => editor.locator('.sb-target-group').filter({ hasText: name })
  await expectVisible(group('工作区能力').getByRole('group', { name: '进行中可见工作区' }))
  await expectVisible(group('交易日志').getByRole('button', { name: /^QA 保存视图（交易日志）：/ }))
  const strategyButton = (name) => editor.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(name)}（交易日志 · 策略）：`),
  })
  await expectVisible(group('策略').getByRole('button', {
    name: new RegExp(`^${escapeRegExp(primaryStrategy)}（交易日志 · 策略）：`),
  }))
  await expectVisible(group('案例记录').getByRole('button', { name: /^重点（案例记录）：/ }))

  const primaryStrategyButton = strategyButton(primaryStrategy)
  await expectAttribute(primaryStrategyButton, 'aria-label', `${primaryStrategy}（交易日志 · 策略）：未添加，点击添加`)
  await primaryStrategyButton.click()
  await expectAttribute(primaryStrategyButton, 'aria-label', `${primaryStrategy}（交易日志 · 策略）：常驻，点击改到更多`)
  await primaryStrategyButton.click()
  await expectAttribute(primaryStrategyButton, 'aria-label', `${primaryStrategy}（交易日志 · 策略）：更多，点击移除`)
  await primaryStrategyButton.click()
  await expectAttribute(primaryStrategyButton, 'aria-label', `${primaryStrategy}（交易日志 · 策略）：未添加，点击添加`)

  await search.fill(primaryStrategy)
  await expectVisible(strategyButton(primaryStrategy))
  await search.fill('不会匹配失效引用')
  await expectCount(editor.getByText('已删除的保存视图'), 0)
  await search.fill('')

  await editor.getByRole('button', { name: /^QA 保存视图（交易日志）：/ }).click()
  await strategyButton(primaryStrategy).click()
  await editor.getByRole('button', { name: /^重点（案例记录）：/ }).click()
  await strategyButton(secondaryStrategy).click()
  await expectText(page.locator('[data-sidebar-capacity]'), /常驻 8 \/ 8/)
  await strategyButton(overflowStrategy).click()
  await expectVisible(editor.getByText(/常驻已满，已放入「更多」/))
  await expectText(strategyButton(overflowStrategy), /更多/)
  await editor.getByRole('button', { name: '返回管理列表' }).click()
  await expectVisible(editor.locator('[data-sidebar-editor-overflow] [data-sidebar-item-label]', { hasText: overflowStrategy }))

  await editor.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(250)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  const persistedLabels = await page.locator('.sb-workspace > a .sb-item-label').allTextContents()
  if (persistedLabels[0] !== originalLabels[1] || persistedLabels[1] !== originalLabels[0]) {
    throw new Error('Completed ordering was not persisted across refresh')
  }
  await expectVisible(page.locator('[data-sidebar-overflow] .sb-item-label', { hasText: overflowStrategy }))
  await expectCount(page.locator('.sb-workspace > a', { hasText: overflowStrategy }), 0)
  await expectVisible(page.getByRole('button', { name: '管理更多项目' }))

  const savedWorkspaceLink = page.locator('.sb-workspace > a', { hasText: 'QA 保存视图' })
  await savedWorkspaceLink.click()
  await expectUrl(page, '/list?status=open', 'Saved view must navigate to its exact query')
  await expectAttribute(savedWorkspaceLink, 'aria-current', 'page')
  await expectActiveSidebarLabels(
    page,
    ['QA 保存视图'],
    'Exact saved view must be the only strongly selected sidebar item',
  )
  await expectCount(savedWorkspaceLink.locator('.sb-modified-dot'), 0)
  await page.goto(`${BASE}/list?status=open&side=long`, { waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  const modifiedSavedLink = page.locator('.sb-workspace > a', { hasText: 'QA 保存视图' })
  await expectAttribute(modifiedSavedLink, 'aria-current', 'page')
  await expectActiveSidebarLabels(
    page,
    ['QA 保存视图'],
    'Modified saved view must remain the only strongly selected sidebar item',
  )
  await expectCount(modifiedSavedLink.locator('.sb-modified-dot'), 1)
  await modifiedSavedLink.click()
  await expectUrl(page, '/list?status=open', 'Clicking a modified saved view must restore its original query')

  const coreLink = (label) => page.locator('.sb-primary > a', { hasText: label })
  await page.goto(`${BASE}/active/board?status=open`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(250)
  await coreLink('今日').click()
  await coreLink('交易').click()
  await expectUrl(page, '/active/board?status=open', 'Trade core must restore pathname, search, and board mode')

  await page.goto(`${BASE}/today-record/table?status=planned`, { waitUntil: 'domcontentloaded' })
  await expectUrl(page, '/today-record?status=planned', 'Legacy table URL must redirect to the canonical list')
  await coreLink('案例').click()
  await coreLink('今日').click()
  await expectUrl(page, '/today-record', 'Today core must restore the canonical focused workspace')

  await page.goto(`${BASE}/review-cases/mistakes/board?reviewStatus=focus`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(250)
  await coreLink('交易').click()
  await coreLink('案例').click()
  await expectUrl(page, '/review-cases/mistakes/board?reviewStatus=focus', 'Case core must restore pathname, search, and board mode')

  const anchorTradeId = await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    const { flushPersistNow } = await import('/src/storage/persist.ts')
    const state = useStore.getState()
    const strategyId = state.strategies[0]?.id
    if (!strategyId) throw new Error('Anchor QA requires a strategy')
    const source = {
      id: 'qa-anchor-source',
      ref: 'QA-SOURCE',
      symbol: 'QASOURCE',
      side: 'long',
      status: 'planned',
      conviction: 'medium',
      strategyId,
      tags: [],
      mistakeTags: [],
      reviewStatus: 'unreviewed',
      reviewCategory: 'normal',
      tradeKind: 'live',
      entry: 0,
      exit: null,
      stopLoss: null,
      size: 0,
      pnl: 0,
      rMultiple: 0,
      openedAt: '2026-06-01',
      closedAt: null,
      note: '',
    }
    const trades = Array.from({ length: 36 }, (_, index) => ({
      ...source,
      id: `qa-anchor-${index}`,
      ref: `QA-${String(index).padStart(3, '0')}`,
      symbol: `QA${index}`,
      status: 'planned',
      openedAt: `2026-06-${String((index % 28) + 1).padStart(2, '0')}`,
      deletedAt: undefined,
    }))
    useStore.setState({ trades })
    await flushPersistNow()
    return trades[35].id
  })
  await page.setViewportSize({ width: 900, height: 600 })
  for (const scenario of [
    { path: '/list', scroll: '.list-scroll', open: 'button' },
    { path: '/board', scroll: { containerSelector: '.bd-col-body', intersectWindow: true }, open: 'card' },
  ]) {
    await page.goto(`${BASE}${scenario.path}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
    const anchor = await ensureTradeRowVisible(page, anchorTradeId)
    await anchor.scrollIntoViewIfNeeded()
    if (scenario.open === 'button') await anchor.locator('.trade-row-open').click()
    else await anchor.click()
    await page.waitForURL((url) => url.pathname.startsWith('/trade/'), { timeout: 10000 })
    await expectVisible(page.getByRole('link', { name: '返回列表' }).first())
    await page.getByRole('link', { name: '返回列表' }).first().click()
    await expectUrl(page, scenario.path, `${scenario.path} detail return must preserve its source route`)
    await ensureTradeRowVisible(page, anchorTradeId)
    await expectTradeInScrollViewport(page, anchorTradeId, scenario.scroll)
  }
  await coreLink('仪表盘').click()
  await page.evaluate(async () => {
    const { rememberTradeReturnAnchor } = await import('/src/hooks/useTradeReturnAnchor.ts')
    rememberTradeReturnAnchor({ pathname: '/list', search: '', anchorTradeId: 'qa-abandoned-anchor' })
  })
  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  await expectUrl(page, '/list', 'Abandoned anchor setup must enter its intended list route')
  await page.waitForTimeout(800)
  const abandonedAnchorStored = await page.evaluate(() =>
    Object.keys(sessionStorage).some((key) => key.startsWith('trade-return-anchor:')),
  )
  if (abandonedAnchorStored) throw new Error('An attempted missing return anchor must be consumed immediately')
  await page.locator('.list-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.waitForTimeout(100)
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    const state = useStore.getState()
    const source = state.trades[0]
    if (!source) throw new Error('Abandoned anchor QA requires a source trade')
    useStore.setState({
      trades: [
        ...state.trades,
        { ...source, id: 'qa-abandoned-anchor', ref: 'QA-ABANDONED', openedAt: '2020-01-01' },
      ],
    })
  })
  await coreLink('仪表盘').click()
  await coreLink('交易').click()
  await expectUrl(page, '/list', 'Trade core must return after abandoned anchor setup')
  await page.waitForTimeout(250)
  const abandonedScrollTop = await page.locator('.list-scroll').evaluate((element) => element.scrollTop)
  if (abandonedScrollTop > 20) throw new Error(`Consumed missing anchor caused surprise later scrolling: ${abandonedScrollTop}`)
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    useStore.getState().removeTradeView('qa-saved-view')
  })
  await expectCount(page.locator('.sb-workspace > a', { hasText: '已删除的保存视图' }), 0)
  await page.getByRole('button', { name: '管理我的空间', exact: true }).click()
  const invalidRow = editor.locator('[data-sidebar-item]', { hasText: '已删除的保存视图' })
  await expectText(invalidRow, /已失效/)
  await invalidRow.getByRole('button', { name: /^删除 / }).click()
  await expectCount(invalidRow, 0)
  await editor.getByRole('button', { name: '完成' }).click()
  await waitForAutoSave(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  await page.getByRole('button', { name: '管理我的空间', exact: true }).click()
  await expectCount(page.getByRole('dialog', { name: '管理我的空间' }).locator('[data-sidebar-item]', { hasText: '已删除的保存视图' }), 0)

  const restoredEditor = page.getByRole('dialog', { name: '管理我的空间' })
  const restoredRows = restoredEditor.locator('[data-sidebar-item]')
  const draftCountBeforeRestore = await restoredRows.count()
  await restoredEditor.getByRole('button', { name: '恢复默认' }).click()
  await expectVisible(restoredEditor.getByText('确认恢复默认项目？当前草稿将被替换。'))
  if (await restoredRows.count() !== draftCountBeforeRestore) throw new Error('Restore default changed draft before confirmation')
  await restoredEditor.getByRole('button', { name: '取消恢复默认' }).click()
  await expectCount(restoredEditor.getByText('确认恢复默认项目？当前草稿将被替换。'), 0)
  await restoredEditor.getByRole('button', { name: '恢复默认' }).click()
  await restoredEditor.getByRole('button', { name: '确认恢复默认' }).click()
  await expectText(page.locator('[data-sidebar-capacity]'), /常驻 4 \/ 8/)
  await restoredEditor.getByRole('button', { name: '完成' }).click()
  await waitForAutoSave(page)
  await page.waitForFunction(async () => {
    return new Promise((resolve) => {
      const open = indexedDB.open('linear-journal-v3')
      open.onerror = () => resolve(false)
      open.onsuccess = () => {
        const database = open.result
        const request = database.transaction('snapshot', 'readonly').objectStore('snapshot').get('main')
        request.onerror = () => { database.close(); resolve(false) }
        request.onsuccess = async () => {
          try {
            const snapshot = request.result instanceof Blob
              ? JSON.parse(await request.result.text())
              : request.result
            const ids = snapshot?.display?.sidebarWorkspaceItems?.map((item) => item.id)
            resolve(JSON.stringify(ids) === JSON.stringify([
              'system:active', 'system:favorites', 'system:missed', 'system:paper',
            ]))
          } catch {
            resolve(false)
          } finally {
            database.close()
          }
        }
      }
    })
  }, undefined, { timeout: 10_000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  const expectedDefaultLabels = ['进行中', '星标交易', '错过的机会', '模拟回测']
  try {
    await page.waitForFunction((expectedLabels) => {
      const labels = [...document.querySelectorAll('.sb-workspace > a .sb-item-label')]
        .map((element) => element.textContent?.trim() ?? '')
      return JSON.stringify(labels) === JSON.stringify(expectedLabels)
    }, expectedDefaultLabels, { timeout: 10_000 })
  } catch (error) {
    const actualLabels = await page.locator('.sb-workspace > a .sb-item-label').allTextContents()
    throw new Error(`Restore default reload did not converge: ${JSON.stringify(actualLabels)}`, { cause: error })
  }
  const defaultLabels = await page.locator('.sb-workspace > a .sb-item-label').allTextContents()
  expectEqual(defaultLabels, expectedDefaultLabels, 'Restore default must persist exact default names and order')

  for (const width of [1920, 1440, 900]) {
    await page.setViewportSize({ width, height: 844 })
    await expectVisible(page.locator('.sidebar'))
    await expectCount(page.getByRole('navigation', { name: '移动导航' }), 0)
    await expectNoHorizontalOverflow(page)
  }
  const desktopCoreHrefs = await page.locator('.sb-primary > a').evaluateAll((elements) => elements.map((element) => element.getAttribute('href')))

  await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    const state = useStore.getState()
    state.saveTradeView({
      id: 'qa-saved-view',
      name: 'QA 保存视图',
      pathname: '/list',
      search: { status: 'open' },
      pinned: false,
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    state.replaceSidebarWorkspaceItems([
      ...state.display.sidebarWorkspaceItems,
      {
        id: 'qa-mobile-overflow',
        target: { kind: 'saved-view', viewId: 'qa-saved-view' },
        placement: 'overflow',
        order: state.display.sidebarWorkspaceItems.length,
      },
    ])
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await expectHidden(page.locator('.sidebar'))
  const mobileNavigation = page.getByRole('navigation', { name: '移动导航' })
  await expectVisible(mobileNavigation)
  const mobileActions = mobileNavigation.locator('a, button')
  expectEqual(
    await mobileActions.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '')),
    ['今日', '交易日志', '案例', '仪表盘', '更多'],
    'Mobile navigation must expose exactly five named actions',
  )
  expectEqual(
    await mobileNavigation.locator(':scope > a').evaluateAll((elements) => elements.map((element) => element.getAttribute('href'))),
    desktopCoreHrefs.filter((href) => (
      href !== '/review-session' && href !== '/weekly-review' && href !== '/notes'
    )),
    'Mobile core navigation hrefs must come from the same targets as desktop',
  )
  for (const action of await mobileActions.all()) {
    const box = await action.boundingBox()
    if (!box || box.height < 44 || box.width < 44) throw new Error('Every mobile navigation action must have a 44px hit target')
  }
  await expectNoHorizontalOverflow(page)
  await expectMobileCurrentCount(page, 1)

  const moreButton = page.locator('.mobile-navigation > button[aria-label="更多"]')
  await moreButton.click()
  const drawer = page.getByRole('dialog', { name: '更多' })
  await expectVisible(drawer)
  await expectAttribute(drawer, 'aria-modal', 'true')
  await expectAttribute(moreButton, 'aria-expanded', 'true')
  if ((await moreButton.getAttribute('class'))?.includes('is-active')) throw new Error('More must not use page-active styling while open')
  await expectFocused(drawer.getByRole('button', { name: '关闭更多' }))
  const overlayZIndex = Number(await page.locator('.mobile-navigation-overlay').evaluate((element) => getComputedStyle(element).zIndex))
  const navigationZIndex = Number(await page.locator('.mobile-navigation').evaluate((element) => getComputedStyle(element).zIndex))
  if (overlayZIndex <= navigationZIndex) throw new Error(`Drawer overlay must stack above mobile navigation: ${overlayZIndex} <= ${navigationZIndex}`)
  for (const background of [page.locator('.ui-main-frame'), page.locator('.mobile-navigation')]) {
    if (!(await background.evaluate((element) => element.inert))) throw new Error('Modal background must be inert')
    await expectAttribute(background, 'aria-hidden', 'true')
  }
  if (await page.evaluate(() => document.body.style.overflow) !== 'hidden') throw new Error('Opening a mobile modal must lock body scrolling')
  await page.setViewportSize({ width: 900, height: 844 })
  await expectVisible(page.locator('.sidebar'))
  await expectCount(drawer, 0)
  await page.waitForFunction(() => !document.querySelector('.ui-main-frame')?.inert && document.body.style.overflow !== 'hidden')
  await expectCount(page.locator('.mobile-navigation-overlay'), 0)
  if (await page.locator('.ui-main-frame').evaluate((element) => element.inert)) throw new Error('Desktop main must be interactive after closing drawer across breakpoint')
  await expectAttribute(page.locator('.ui-main-frame'), 'aria-hidden', null)
  if (await page.evaluate(() => document.body.style.overflow) === 'hidden') throw new Error('Crossing to desktop with drawer open must restore body scrolling')
  await page.setViewportSize({ width: 390, height: 844 })
  await moreButton.click()
  await expectVisible(drawer)
  expectEqual(
    await drawer.locator('[data-mobile-workspace-item]').allTextContents(),
    ['进行中', '星标交易', '错过的机会', '模拟回测', 'QA 保存视图'],
    'More drawer must contain every valid pinned and overflow item in order',
  )
  const expectedDrawerItems = ['进行中', '星标交易', '错过的机会', '模拟回测', 'QA 保存视图', '随记', '周复盘', '随机复盘', '搜索', '设置', '回收站', '管理我的空间']
  expectEqual(
    await drawer.locator('[data-mobile-drawer-item]').allTextContents(),
    expectedDrawerItems,
    'More drawer workspace and utility items must preserve their complete order',
  )
  for (const name of expectedDrawerItems.slice(5)) {
    const role = ['随记', '周复盘', '随机复盘', '设置', '回收站'].includes(name) ? 'link' : 'button'
    await expectVisible(drawer.getByRole(role, { name, exact: true }))
  }
  for (const action of await drawer.locator('a, button').all()) {
    const box = await action.boundingBox()
    if (!box || box.height < 44) throw new Error('Every mobile drawer action must have a 44px hit target')
  }
  await drawer.locator('[data-mobile-drawer-item]').last().focus()
  await page.keyboard.press('Tab')
  await expectFocusInside(drawer)
  await drawer.getByRole('button', { name: '关闭更多' }).focus()
  await page.keyboard.press('Shift+Tab')
  await expectFocusInside(drawer)
  await drawer.getByRole('button', { name: '关闭更多' }).click()
  await expectCount(drawer, 0)
  await expectFocused(moreButton)

  await moreButton.click()
  await page.locator('.mobile-navigation-backdrop').click({ position: { x: 4, y: 4 } })
  await expectCount(drawer, 0)
  await expectFocused(moreButton)
  await expectAttribute(moreButton, 'aria-expanded', 'false')
  for (const background of [page.locator('.ui-main-frame'), page.locator('.mobile-navigation')]) {
    if (await background.evaluate((element) => element.inert)) throw new Error('Closing a mobile modal must restore background interaction')
    await expectAttribute(background, 'aria-hidden', null)
  }
  if (await page.evaluate(() => document.body.style.overflow) === 'hidden') throw new Error('Closing a mobile modal must restore body scrolling')

  await moreButton.click()
  await page.keyboard.press('Escape')
  await expectCount(drawer, 0)
  await expectFocused(moreButton)

  await moreButton.click()
  await page.evaluate(() => {
    history.pushState({}, '', '/dashboard')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expectCount(drawer, 0)
  await expectFocused(moreButton)
  await expectMobileCurrentCount(page, 1)

  const coreLabels = ['今日', '交易日志', '案例', '仪表盘']
  for (const label of coreLabels) {
    await moreButton.click()
    await page.locator(`.mobile-navigation > a[aria-label="${label}"]`).click({ force: true })
    await expectCount(drawer, 0)
    await expectFocused(moreButton)
    await expectMobileCurrentCount(page, 1)
  }

  for (const label of expectedDrawerItems.slice(0, 5)) {
    await moreButton.click()
    await drawer.getByRole('link', { name: label, exact: true }).click()
    await expectCount(drawer, 0)
    await expectFocused(moreButton)
    await moreButton.click()
    await expectMobileCurrentCount(page, 1)
    expectEqual(await drawer.locator('[data-mobile-drawer-item]').allTextContents(), expectedDrawerItems, 'Drawer order changed after workspace navigation')
    await page.keyboard.press('Escape')
  }

  for (const label of ['设置', '回收站']) {
    await moreButton.click()
    await drawer.getByRole('link', { name: label, exact: true }).click()
    await expectCount(drawer, 0)
    await expectFocused(moreButton)
    await moreButton.click()
    await expectMobileCurrentCount(page, 1)
    await page.keyboard.press('Escape')
  }

  await page.locator('.mobile-navigation > a[aria-label="今日"]').click()
  await expectCount(drawer, 0)
  await moreButton.click()
  await moreButton.evaluate((element) => {
    const target = element
    target.dataset.qaFocusCount = '0'
    target.addEventListener('focus', () => {
      target.dataset.qaFocusCount = String(Number(target.dataset.qaFocusCount ?? '0') + 1)
    }, { once: true })
  })
  await drawer.getByRole('button', { name: '搜索', exact: true }).click()
  await expectCount(drawer, 0)
  const commandPaletteInput = page.locator('.cmdk-input')
  await expectVisible(commandPaletteInput)
  await expectFocused(commandPaletteInput)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(50)
  await expectFocused(commandPaletteInput)
  if (await moreButton.evaluate((element) => element === document.activeElement)) {
    throw new Error('Closed-drawer core navigation left a stale restore flag that stole Command Palette focus')
  }
  if (await moreButton.getAttribute('data-qa-focus-count') !== '0') {
    throw new Error('Closed-drawer core navigation caused More to take transient focus during search modal transition')
  }
  await commandPaletteInput.press('Escape')
  await expectCount(commandPaletteInput, 0)

  await moreButton.click()
  await drawer.getByRole('button', { name: '管理我的空间', exact: true }).click()
  await expectCount(drawer, 0)
  const mobileEditor = page.getByRole('dialog', { name: '管理我的空间' })
  await expectVisible(mobileEditor)
  await expectAttribute(mobileEditor, 'data-mobile-fullscreen', 'true')
  await expectAttribute(mobileEditor, 'aria-modal', 'true')
  await expectFocused(mobileEditor.getByRole('heading', { name: '管理我的空间' }))
  for (const background of [page.locator('.ui-main-frame'), page.locator('.mobile-navigation')]) {
    if (!(await background.evaluate((element) => element.inert))) throw new Error('Full-screen editor background must be inert')
    await expectAttribute(background, 'aria-hidden', 'true')
  }
  if (await page.evaluate(() => document.body.style.overflow) !== 'hidden') throw new Error('Full-screen editor must lock body scrolling')
  await page.setViewportSize({ width: 900, height: 844 })
  await expectVisible(page.locator('.sidebar'))
  await page.waitForFunction(() => !document.querySelector('.ui-main-frame')?.inert && document.body.style.overflow !== 'hidden')
  await expectCount(page.locator('.mobile-navigation-editor-host'), 0)
  await expectCount(page.locator('.mobile-navigation-overlay'), 0)
  if (await page.locator('.ui-main-frame').evaluate((element) => element.inert)) throw new Error('Desktop main must be interactive after closing editor across breakpoint')
  await expectAttribute(page.locator('.ui-main-frame'), 'aria-hidden', null)
  if (await page.evaluate(() => document.body.style.overflow) === 'hidden') throw new Error('Crossing to desktop with editor open must restore body scrolling')
  await page.setViewportSize({ width: 390, height: 844 })
  await moreButton.click()
  await drawer.getByRole('button', { name: '管理我的空间', exact: true }).click()
  await expectVisible(mobileEditor)
  await expectNoHorizontalOverflow(page, mobileEditor)
  const firstMobileLabel = (await mobileEditor.locator('[data-sidebar-item-label]').first().textContent()) ?? ''
  await expectVisible(mobileEditor.getByRole('button', { name: `下移 ${firstMobileLabel}` }))
  await expectVisible(mobileEditor.getByRole('button', { name: `上移 ${firstMobileLabel}` }))
  await mobileEditor.getByRole('button', { name: `下移 ${firstMobileLabel}` }).focus()
  await page.keyboard.press('Shift+Tab')
  await expectFocusInside(mobileEditor)
  await mobileEditor.getByRole('button', { name: `下移 ${firstMobileLabel}` }).click()
  const movedMobileLabels = await mobileEditor.locator('[data-sidebar-item-label]').allTextContents()
  if (movedMobileLabels[1] !== firstMobileLabel) throw new Error('Mobile down button did not reorder the first item')
  await mobileEditor.getByRole('button', { name: '完成', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expectFocusInside(mobileEditor)
  await page.keyboard.press('Escape')
  await expectCount(mobileEditor, 0)
  await expectFocused(moreButton)
  if (await page.evaluate(() => document.body.style.overflow) === 'hidden') throw new Error('Closing full-screen editor must restore body scrolling')
  await expectNoHorizontalOverflow(page)

  await moreButton.click()
  await drawer.getByRole('button', { name: '管理我的空间', exact: true }).click()
  await expectVisible(mobileEditor)
  await mobileEditor.getByRole('button', { name: '取消', exact: true }).click()
  await expectCount(mobileEditor, 0)
  await expectFocused(moreButton)

  const orderBeforeCommit = await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    return useStore.getState().display.sidebarWorkspaceItems.map((item) => item.id)
  })
  await moreButton.click()
  await drawer.getByRole('button', { name: '管理我的空间', exact: true }).click()
  await expectVisible(mobileEditor)
  const commitFirstLabel = (await mobileEditor.locator('[data-sidebar-item-label]').first().textContent()) ?? ''
  await mobileEditor.getByRole('button', { name: `下移 ${commitFirstLabel}` }).click()
  await mobileEditor.getByRole('button', { name: '完成', exact: true }).click()
  await expectCount(mobileEditor, 0)
  await expectFocused(moreButton)
  const orderAfterCommit = await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    return useStore.getState().display.sidebarWorkspaceItems.map((item) => item.id)
  })
  if (orderAfterCommit[1] !== orderBeforeCommit[0] || orderAfterCommit[0] !== orderBeforeCommit[1]) {
    throw new Error('Completing the mobile editor did not commit the reordered workspace state')
  }

  if (browserProblems.length > 0) {
    throw new Error(`Browser console reported unexpected problems:\n${browserProblems.join('\n')}`)
  }

  console.log('PASS: nine sidebar workflows, detail return anchors, and 1920/1440/900/390 responsive contract')
} finally {
  await browser?.close()
  await stopVite(vite)
}

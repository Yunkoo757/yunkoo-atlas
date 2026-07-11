import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 41713
const BASE = `http://127.0.0.1:${PORT}`
const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, '')

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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (earlyExit) {
      throw new Error(`Vite exited before ready (${earlyExit.signal ?? `code ${earlyExit.code}`}): ${vite.output().trim()}`)
    }
    if (!vite.hasReadySignal()) {
      await new Promise((resolve) => setTimeout(resolve, 50))
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

async function expectHidden(locator) {
  await locator.waitFor({ state: 'hidden', timeout: 5000 })
}

async function expectText(locator, expected) {
  await expectVisible(locator)
  const actual = (await locator.textContent()) ?? ''
  if (!expected.test(actual)) throw new Error(`Expected ${expected}, received ${JSON.stringify(actual)}`)
}

async function expectAttribute(locator, name, expected) {
  const actual = await locator.getAttribute(name)
  if (actual !== expected) throw new Error(`Expected ${name}=${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}

function expectEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

async function expectCount(locator, expected) {
  const actual = await locator.count()
  if (actual !== expected) throw new Error(`Expected count ${expected}, received ${actual}`)
}

async function expectFocused(locator) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected element to be focused')
}

await verifyExistingViteConflict()
const vite = startVite()
let browser

try {
  await waitForVite(vite)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})

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
  const headingId = await editorHeading.getAttribute('id')
  if (!headingId) throw new Error('Manager heading must have an id')
  await expectAttribute(editor, 'aria-labelledby', headingId)
  await expectFocused(editorHeading)
  await expectText(page.locator('[data-sidebar-capacity]'), /\d+ \/ 8/)
  await expectVisible(page.getByRole('button', { name: '浏览可添加项目' }))

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
  const firstHandle = rows.nth(0).getByRole('button', { name: `排序 ${originalLabels[0]}` })
  const descriptionId = await firstHandle.getAttribute('aria-describedby')
  if (!descriptionId) throw new Error('Sort handle must describe position and shortcuts')
  await expectText(editor.locator(`#${descriptionId}`), /第 1 项，共 \d+ 项。使用 Alt \+ 上\/下方向键排序/)
  await firstHandle.press('Alt+ArrowDown')
  await expectText(editor.locator('[aria-live="polite"]'), new RegExp(`${originalLabels[0]} 已移动到第 2 项，共 ${originalLabels.length} 项`))
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

  await editor.getByRole('button', { name: '浏览可添加项目' }).click()
  await expectVisible(editor.getByRole('heading', { name: '选择项目' }))
  const search = editor.getByRole('searchbox', { name: '搜索可添加项目' })
  await search.focus()
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    useStore.getState().setDisplayName('QA 父级重渲染')
  })
  await expectFocused(search)
  for (const group of ['系统快捷', '我的视图', '策略', '案例视图']) {
    await expectVisible(editor.getByRole('heading', { name: group }))
  }
  const group = (name) => editor.locator('.sb-target-group').filter({ hasText: name })
  await expectVisible(group('系统快捷').getByRole('button', { name: /^进行中：/ }))
  await expectVisible(group('我的视图').getByRole('button', { name: /^QA 保存视图：/ }))
  await expectVisible(group('策略').getByRole('button', { name: /^Breakout：/ }))
  await expectVisible(group('案例视图').getByRole('button', { name: /^重点：/ }))

  const breakout = editor.getByRole('button', { name: /^Breakout：/ })
  await expectAttribute(breakout, 'aria-label', 'Breakout：未添加')
  await breakout.click()
  await expectAttribute(breakout, 'aria-label', 'Breakout：常驻')
  await breakout.click()
  await expectAttribute(breakout, 'aria-label', 'Breakout：更多')
  await breakout.click()
  await expectAttribute(breakout, 'aria-label', 'Breakout：未添加')

  await search.fill('Breakout')
  await expectVisible(editor.getByRole('button', { name: /Breakout/ }))
  await search.fill('不会匹配失效引用')
  await expectCount(editor.getByText('已删除的保存视图'), 0)
  await search.fill('')

  for (const strategy of ['Breakout', 'Mean Reversion', 'Trend Following', 'News Catalyst', 'Scalp']) {
    await editor.getByRole('button', { name: new RegExp(`^${strategy}：`) }).click()
  }
  await expectText(page.locator('[data-sidebar-capacity]'), /8 \/ 8/)
  await expectVisible(editor.getByText('常驻项目已满，已添加到更多'))
  await expectText(editor.getByRole('button', { name: /^Scalp：/ }), /更多/)
  await editor.getByRole('button', { name: '返回管理列表' }).click()

  await editor.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(250)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  const persistedLabels = await page.locator('.sb-workspace > a .sb-item-label').allTextContents()
  if (persistedLabels[0] !== originalLabels[1] || persistedLabels[1] !== originalLabels[0]) {
    throw new Error('Completed ordering was not persisted across refresh')
  }

  await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    const state = useStore.getState()
    state.replaceSidebarWorkspaceItems([
      ...state.display.sidebarWorkspaceItems,
      {
        id: 'qa-invalid-saved-view',
        target: { kind: 'saved-view', viewId: 'missing-view' },
        placement: 'overflow',
        order: state.display.sidebarWorkspaceItems.length,
      },
    ])
  })
  await expectCount(page.locator('.sb-workspace > a', { hasText: '已删除的保存视图' }), 0)
  await page.getByRole('button', { name: '管理我的空间', exact: true }).click()
  const invalidRow = editor.locator('[data-sidebar-item]', { hasText: '已删除的保存视图' })
  await expectText(invalidRow, /已失效/)
  await invalidRow.getByRole('button', { name: /^删除 / }).click()
  await expectCount(invalidRow, 0)
  await editor.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(250)
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
  await expectText(page.locator('[data-sidebar-capacity]'), /4 \/ 8/)
  await restoredEditor.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(250)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  const defaultLabels = await page.locator('.sb-workspace > a .sb-item-label').allTextContents()
  expectEqual(defaultLabels, ['进行中', '星标交易', '错过的机会', '模拟回测'], 'Restore default must persist exact default names and order')

  await page.setViewportSize({ width: 900, height: 844 })
  await expectVisible(page.locator('.sidebar'))
  await expectCount(page.getByRole('navigation', { name: '移动导航' }), 0)

  await page.evaluate(async () => {
    const { useStore } = await import('/src/store/useStore.ts')
    const state = useStore.getState()
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
    ['今日', '交易', '案例', '仪表盘', '更多'],
    'Mobile navigation must expose exactly five named actions',
  )
  for (const action of await mobileActions.all()) {
    const box = await action.boundingBox()
    if (!box || box.height < 44 || box.width < 44) throw new Error('Every mobile navigation action must have a 44px hit target')
  }
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth)
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  if (scrollWidth > viewportWidth) throw new Error(`Mobile page overflowed horizontally: ${scrollWidth} > ${viewportWidth}`)

  const moreButton = mobileNavigation.getByRole('button', { name: '更多', exact: true })
  await moreButton.click()
  const drawer = page.getByRole('dialog', { name: '更多' })
  await expectVisible(drawer)
  expectEqual(
    await drawer.locator('[data-mobile-workspace-item]').allTextContents(),
    ['进行中', '星标交易', '错过的机会', '模拟回测', 'QA 保存视图'],
    'More drawer must contain every valid pinned and overflow item in order',
  )
  for (const name of ['搜索', '设置', '回收站', '管理我的空间']) {
    await expectVisible(drawer.getByRole(name === '设置' || name === '回收站' ? 'link' : 'button', { name, exact: true }))
  }
  for (const action of await drawer.locator('a, button').all()) {
    const box = await action.boundingBox()
    if (!box || box.height < 44) throw new Error('Every mobile drawer action must have a 44px hit target')
  }
  await drawer.getByRole('button', { name: '关闭更多' }).click()
  await expectCount(drawer, 0)
  await expectFocused(moreButton)

  await moreButton.click()
  await drawer.getByRole('button', { name: '管理我的空间', exact: true }).click()
  await expectCount(drawer, 0)
  const mobileEditor = page.getByRole('dialog', { name: '管理我的空间' })
  await expectVisible(mobileEditor)
  await expectAttribute(mobileEditor, 'data-mobile-fullscreen', 'true')
  const firstMobileLabel = (await mobileEditor.locator('[data-sidebar-item-label]').first().textContent()) ?? ''
  await expectVisible(mobileEditor.getByRole('button', { name: `下移 ${firstMobileLabel}` }))
  await expectVisible(mobileEditor.getByRole('button', { name: `上移 ${firstMobileLabel}` }))
  await mobileEditor.getByRole('button', { name: `下移 ${firstMobileLabel}` }).click()
  const movedMobileLabels = await mobileEditor.locator('[data-sidebar-item-label]').allTextContents()
  if (movedMobileLabels[1] !== firstMobileLabel) throw new Error('Mobile down button did not reorder the first item')
  await mobileEditor.getByRole('button', { name: '取消', exact: true }).click()
  await expectCount(mobileEditor, 0)
  await expectFocused(moreButton)
  const finalScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  if (finalScrollWidth > viewportWidth) throw new Error(`Mobile editor overflowed horizontally: ${finalScrollWidth} > ${viewportWidth}`)

  console.log('PASS: sidebar workspace manager and responsive mobile navigation contract')
} finally {
  await browser?.close()
  await stopVite(vite)
}

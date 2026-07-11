import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 41713
const BASE = `http://127.0.0.1:${PORT}`

function startVite() {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, output: () => output }
}

async function waitForVite(vite) {
  let earlyExit = null
  const handleExit = (code, signal) => { earlyExit = { code, signal } }
  vite.child.once('exit', handleExit)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (earlyExit) {
      throw new Error(`Vite exited before ready (${earlyExit.signal ?? `code ${earlyExit.code}`}): ${vite.output().trim()}`)
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

async function expectVisible(locator) {
  await locator.waitFor({ state: 'visible', timeout: 5000 })
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

  const search = editor.getByRole('searchbox', { name: '搜索可添加项目' })
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

  console.log('PASS: sidebar workspace manager contract')
} finally {
  await browser?.close()
  vite.child.kill()
}

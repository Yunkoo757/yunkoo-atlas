import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 41713
const BASE = `http://127.0.0.1:${PORT}`

function startVite() {
  return spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    stdio: 'ignore',
  })
}

async function waitForVite() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(BASE)
      if (response.ok) return
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
  await waitForVite()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})

  await page.getByRole('button', { name: '管理我的空间', exact: true }).click()
  await expectVisible(page.getByRole('heading', { name: '管理我的空间' }))
  await expectText(page.locator('[data-sidebar-capacity]'), /\d+ \/ 8/)
  await expectVisible(page.getByRole('button', { name: '浏览可添加项目' }))

  const editor = page.locator('.sb-workspace-editor')
  const rows = editor.locator('[data-sidebar-item]')
  const originalLabels = await rows.locator('[data-sidebar-item-label]').allTextContents()
  if (originalLabels.length < 2) throw new Error('Expected at least two editable workspace items')

  await rows.nth(0).dragTo(rows.nth(1))
  const draggedLabels = await rows.locator('[data-sidebar-item-label]').allTextContents()
  if (draggedLabels[1] !== originalLabels[0]) throw new Error('Native drag did not move the first item down')
  await page.keyboard.press('Escape')
  await expectCount(editor, 0)
  const manageButton = page.getByRole('button', { name: '管理我的空间', exact: true })
  await expectFocused(manageButton)
  const dailyLabels = await page.locator('.sb-workspace > a .sb-item-label').allTextContents()
  if (dailyLabels[0] !== originalLabels[0]) throw new Error('Escape persisted the draft unexpectedly')

  await manageButton.click()
  await rows.nth(0).press('Alt+ArrowDown')
  const keyboardLabels = await rows.locator('[data-sidebar-item-label]').allTextContents()
  if (keyboardLabels.join('|') !== draggedLabels.join('|')) throw new Error('Keyboard and drag ordering diverged')
  await rows.nth(1).press('Delete')
  await expectVisible(editor.getByText(/已移除 .* ·/))
  await editor.getByRole('button', { name: '撤销' }).click()
  await expectCount(rows, originalLabels.length)

  await editor.getByRole('button', { name: '浏览可添加项目' }).click()
  await expectVisible(editor.getByRole('heading', { name: '选择项目' }))
  for (const group of ['系统快捷', '我的视图', '策略', '案例视图']) {
    await expectVisible(editor.getByRole('heading', { name: group }))
  }
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
  await invalidRow.getByRole('button', { name: /删除/ }).click()
  await expectCount(invalidRow, 0)
  const draftCountBeforeRestore = await rows.count()
  await editor.getByRole('button', { name: '恢复默认' }).click()
  await expectVisible(editor.getByText('确认恢复默认项目？当前草稿将被替换。'))
  if (await rows.count() !== draftCountBeforeRestore) throw new Error('Restore default changed draft before confirmation')
  await editor.getByRole('button', { name: '取消恢复默认' }).click()
  await expectCount(editor.getByText('确认恢复默认项目？当前草稿将被替换。'), 0)
  await editor.getByRole('button', { name: '恢复默认' }).click()
  await editor.getByRole('button', { name: '确认恢复默认' }).click()
  await expectText(page.locator('[data-sidebar-capacity]'), /4 \/ 8/)

  console.log('PASS: sidebar workspace manager contract')
} finally {
  await browser?.close()
  vite.kill()
}

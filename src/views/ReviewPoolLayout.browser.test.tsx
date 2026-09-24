import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { clearReviewSessionStorage } from '@/lib/reviewSession'
import { bootstrapStorage, getStorage } from '@/storage'
import { useStore } from '@/store/useStore'
import { ReviewSessionView } from './ReviewSessionView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __reviewPoolLayoutTest?: Promise<void> } }

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
async function waitFor(selector: string): Promise<HTMLElement> {
  const deadline = performance.now() + 8_000
  while (performance.now() < deadline) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) { await frame(); return element }
    await frame()
  }
  throw new Error(`未找到 ${selector}`)
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((element) => element.textContent?.trim() === text)
  assert(found, `未找到按钮 ${text}`)
  return found
}
function assertNoHorizontalOverflow(element: HTMLElement, label: string): void {
  assert(element.scrollWidth <= element.clientWidth + 1, `${label} 出现横向溢出：${element.scrollWidth} > ${element.clientWidth}`)
}

async function run(): Promise<void> {
  await bootstrapStorage()
  const manifest = await getStorage().getManifest()
  clearReviewSessionStorage(manifest.libraryId)
  const previous = useStore.getState()
  const name = 'W'.repeat(40)
  const strategyName = 'LongStrategy'.repeat(10)
  const now = new Date().toISOString()
  useStore.setState({
    reviewPoolPresets: [{
      id: 'layout-long-pool', name, createdAt: now, updatedAt: now,
      filters: { sources: [], results: [], caseTypes: [], strategyIds: [], symbols: [], sides: [], tags: [], mistakeTags: [], requireContent: false, stageSource: 'current-and-history' },
    }],
    reviewPoolLayout: { homeOrder: [{ kind: 'system', id: 'all' }, { kind: 'custom', id: 'layout-long-pool' }], hiddenSystemIds: [] },
    strategies: [...previous.strategies, { id: 'layout-long-strategy', name: strategyName, icon: 'trending-up', color: 'var(--accent)' }],
  })
  const root = createRoot(document.getElementById('root')!)
  root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ReviewSessionView /></MemoryRouter>)
  try {
    const start = await waitFor('.review-session-start')
    await document.fonts.ready
    assertNoHorizontalOverflow(start, '长名称复盘池首页')
    const pool = [...start.querySelectorAll<HTMLButtonElement>('.review-session-preset-list button')].find((element) => element.textContent?.includes(name))
    assert(pool, '首页应保留完整复盘池名称')
    assertNoHorizontalOverflow(pool, '长名称复盘池按钮')
    const count = pool.querySelector('.review-session-preset-count')!.getBoundingClientRect()
    const bounds = pool.getBoundingClientRect()
    assert(count.right <= bounds.right && count.left >= bounds.left, '复盘池数量必须保持可见')

    button('更多').click()
    await waitFor('[role="menuitem"]')
    const managerMenu = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.includes('管理复盘池'))
    assert(managerMenu, '应保留管理复盘池入口')
    managerMenu.click()
    const order = await waitFor('.review-pool-home-order')
    const managerBody = order.closest<HTMLElement>('.modal-shell-body')!
    assertNoHorizontalOverflow(managerBody, '复盘池管理正文')
    for (const row of order.querySelectorAll<HTMLElement>('li')) assertNoHorizontalOverflow(row, '复盘池排序行')
    const edit = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.getAttribute('aria-label') === `编辑 ${name}`)
    assert(edit, '长名称复盘池应保留编辑入口')
    edit.click()
    const editor = await waitFor('.review-pool-editor')
    const editorBody = editor.closest<HTMLElement>('.modal-shell-body')!
    assertNoHorizontalOverflow(editorBody, '复盘池编辑正文')
    const choice = [...editor.querySelectorAll<HTMLElement>('.review-pool-choice-group label')].find((element) => element.textContent === strategyName)
    assert(choice, '长策略名称应完整保留')
    assertNoHorizontalOverflow(choice, '长策略筛选项')
    const checkbox = choice.querySelector<HTMLInputElement>('input')!
    assert(checkbox.getBoundingClientRect().width >= 15, '长策略不得挤压复选框')
    checkbox.click()
    await frame()
    assert(checkbox.checked, '换行后的策略筛选仍可选择')
    const footer = document.querySelector('.modal-shell-footer')!.getBoundingClientRect()
    assert(footer.bottom <= innerHeight, '滚动正文时保存操作必须保持可达')
  } finally {
    root.unmount()
    clearReviewSessionStorage(manifest.libraryId)
    useStore.setState({ reviewPoolPresets: previous.reviewPoolPresets, reviewPoolLayout: previous.reviewPoolLayout, strategies: previous.strategies })
  }
}
window.__reviewPoolLayoutTest = run()

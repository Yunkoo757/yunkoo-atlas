import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ToastHost } from '@/components/Toast'
import { QuickViewBar } from './QuickViewBar'
import { useStore } from '@/store/useStore'
import { toastStore } from '@/lib/toast'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window { __journalTabOverflowTest?: Promise<void> }
}

async function waitFor(check: () => boolean, message: string) {
  const deadline = performance.now() + 3000
  while (!check()) {
    if (performance.now() > deadline) throw new Error(message)
    await new Promise(requestAnimationFrame)
  }
}

function PaperJournal() {
  const location = useLocation()
  return <main data-location={location.pathname + location.search}>
    <QuickViewBar kind="paper" journal />
  </main>
}

async function run() {
  const mount = document.getElementById('root')!
  mount.style.width = '290px'
  const name = '纽约开盘后的黄金结构确认与执行复盘'
  useStore.setState({ savedTradeViews: [{
    id: 'long-name', name, pathname: '/list', search: { symbol: 'XAUUSD' },
    pinned: false, order: 0, createdAt: '', updatedAt: '',
  }] })
  const root = createRoot(mount)
  flushSync(() => root.render(
    <MemoryRouter initialEntries={['/board?symbol=XAUUSD']}>
      <QuickViewBar kind="trade" journal />
    </MemoryRouter>,
  ))
  const tabList = mount.querySelector<HTMLElement>('[role="tablist"]')!
  const current = () => tabList.querySelector<HTMLButtonElement>('[aria-selected="true"]')!
  const more = mount.querySelector<HTMLButtonElement>('.quick-view-overflow')!
  try {
    await waitFor(() => current()?.textContent === name && more.textContent === '更多视图', '窄轨道应优先保留当前未固定长视图')
    const edges = tabList.getBoundingClientRect()
    const selected = current().getBoundingClientRect()
    if (selected.left < edges.left || selected.right > more.getBoundingClientRect().left) throw new Error('选中视图不能藏在收纳入口下方')

    more.click()
    await waitFor(() => !!mount.querySelector('.quick-view-menu'), '更多视图未展开')
    const loss = Array.from(mount.querySelectorAll<HTMLButtonElement>('.quick-view-group button')).find(button => button.textContent === '亏损')
    if (!loss) throw new Error('收纳的系统视图必须能从菜单进入')
    loss.click()
    await waitFor(() => current()?.textContent === '亏损' && !mount.querySelector('.quick-view-menu'), '选择收纳项后应出现在快捷栏')
    current().focus()
    current().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await waitFor(() => current()?.textContent === '错过机会' && document.activeElement === current(), 'End 应能切换到收纳的末项并接续焦点')

    mount.style.width = '1000px'
    await waitFor(() => more.textContent === '' && tabList.querySelectorAll('button').length === 6, '扩大轨道应立即恢复全部主视图')

    mount.style.width = '245px'
    useStore.setState({ savedTradeViews: [{
      id: 'saved-case', name, pathname: '/review-cases/focus', search: { symbol: 'XAUUSD' },
      pinned: false, order: 0, createdAt: '', updatedAt: '',
    }] })
    flushSync(() => root.render(
      <MemoryRouter key="case" initialEntries={['/review-cases/focus/board?symbol=XAUUSD']}>
        <QuickViewBar kind="case" />
      </MemoryRouter>,
    ))
    const caseTab = () => mount.querySelector<HTMLButtonElement>('button[role="tab"][aria-selected="true"]')
    await waitFor(() => caseTab()?.textContent === name, '案例看板的未固定长视图应保留在窄工具栏')
    mount.querySelector<HTMLButtonElement>('.quick-view-overflow')!.click()
    await waitFor(() => !!mount.querySelector('.quick-view-menu'), '案例的更多视图应能展开')
    const mistakes = Array.from(mount.querySelectorAll<HTMLButtonElement>('.quick-view-group button'))
      .find(button => button.textContent === '错题')
    if (!mistakes) throw new Error('案例收纳的范围必须可以从更多视图打开')
    mistakes.click()
    await waitFor(() => caseTab()?.textContent === '错题' && document.activeElement === caseTab(), '切换案例范围后应把焦点还给当前视图')
    mount.style.width = '1000px'

    // 在明确选中的内置视图上重复保存，选中身份应转交给新名称。
    useStore.setState({ savedTradeViews: [{
      id: 'old-paper', name: '旧模拟视图', pathname: '/sim', search: {},
      pinned: false, order: 0, createdAt: '', updatedAt: '',
    }] })
    flushSync(() => root.render(
      <MemoryRouter key="paper" initialEntries={[{
        pathname: '/board', search: '?kind=paper', state: { journalView: { type: 'builtin', id: 'all' } },
      }]}>
        <PaperJournal />
      </MemoryRouter>,
    ))
    mount.querySelector<HTMLButtonElement>('.quick-view-overflow')!.click()
    await waitFor(() => !!mount.querySelector('.quick-view-menu'), '模拟视图菜单未打开')
    const hasLegacy = Array.from(mount.querySelectorAll('.quick-view-manage-name')).some(button => button.textContent === '旧模拟视图')
    if (!hasLegacy) throw new Error('统一模拟日志应提供旧 /sim 保存视图')
    mount.querySelector<HTMLButtonElement>('.quick-view-save-entry')!.click()
    await waitFor(() => !!mount.querySelector('.quick-view-save'), '保存当前视图未打开')
    mount.querySelector<HTMLFormElement>('.quick-view-save')!.requestSubmit()
    await waitFor(() => {
      const added = useStore.getState().savedTradeViews.find(view => view.id !== 'old-paper')
      return !!added && added.pathname === '/list' && added.search.kind === 'paper'
        && mount.querySelector('[aria-selected="true"]')?.textContent === added.name
    }, '保存模拟视图应选中新记录，同条件的旧记录或内置视图都不能抢占')
    if (mount.querySelector('main')?.dataset.location !== '/board?kind=paper') throw new Error('保存视图不应离开当前模拟看板')

    // 模拟已占 1 格；实盘独立的第 4 格仍然可用，第 5 个请求应指出可执行的下一步。
    const store = useStore.getState()
    const live = (index: number) => ({
      id: `live-${index}`, name: `实盘视图${index}`, pathname: '/list', search: { symbol: `SYM${index}` },
      pinned: index <= 3, order: index, createdAt: '', updatedAt: '',
    })
    for (let index = 1; index <= 5; index++) store.saveTradeView(live(index))
    flushSync(() => root.render(
      <MemoryRouter key="pin-quota" initialEntries={['/list']}><QuickViewBar kind="trade" journal /><ToastHost /></MemoryRouter>,
    ))
    mount.querySelector<HTMLButtonElement>('.quick-view-overflow')!.click()
    await waitFor(() => !!mount.querySelector('.quick-view-menu'), '实盘保存视图管理未展开')
    const pin = (index: number) => mount.querySelector<HTMLButtonElement>(`button[aria-label="固定 实盘视图${index}"]`)!.click()
    const isPinned = (id: string) => useStore.getState().savedTradeViews.find(view => view.id === id)?.pinned
    const pinControl = mount.querySelector<HTMLButtonElement>('button[aria-label="固定 实盘视图4"]')!
    const pinGlyph = pinControl.querySelector('svg')!
    pin(4)
    await waitFor(() => isPinned('live-4') === true && pinControl.getAttribute('aria-pressed') === 'true', '模拟视图不能占用实盘的固定名额')
    if (!pinGlyph.isConnected || pinControl.querySelector('svg') !== pinGlyph) {
      throw new Error('固定状态切换时必须沿用同一枚图标')
    }
    pin(5)
    if (isPinned('live-5') || !toastStore.getVisible().at(-1)?.message.includes('可先取消固定一个')) throw new Error('第 5 个视图必须有满额反馈')
    if (store.saveTradeView({ ...live(6), pinned: true }) || isPinned('live-6') !== false) throw new Error('直接保存也必须遵守固定额度，并保留未固定的视图')
    store.togglePinTradeView('live-1')
    pin(5)
    if (!isPinned('live-5')) throw new Error('释放一个名额后应能立即固定')

    const original = useStore.getState().savedTradeViews.find(view => view.id === 'live-5')!
    const sidebar = useStore.getState().display.sidebarWorkspaceItems
    store.replaceSidebarWorkspaceItems([...sidebar, { id: 'saved-view:live-5', placement: 'pinned', order: sidebar.length, target: { kind: 'saved-view', viewId: original.id } }])
    const beforeDelete = useStore.getState().display.sidebarWorkspaceItems
    const sidebarEntry = beforeDelete.find(item => item.target.kind === 'saved-view' && item.target.viewId === original.id)!

    mount.querySelector<HTMLButtonElement>('[aria-label="删除 实盘视图5"]')!.click()
    await waitFor(() => !useStore.getState().savedTradeViews.some(view => view.id === original.id), '删除后保存视图仍在列表中')
    if (useStore.getState().display.sidebarWorkspaceItems.some(item => item.id === sidebarEntry.id)) throw Error('删除保存视图后侧栏仍有失效入口')
    const undo = () => Array.from(document.querySelectorAll<HTMLElement>('.toast-panel[data-state="active"]'))
      .find(panel => panel.textContent?.includes('已删除视图「实盘视图5」'))?.querySelector<HTMLButtonElement>('.toast-action')
    await waitFor(() => undo()?.textContent === '撤销', '删除视图后缺少可点击的撤销通知')
    undo()!.click()
    await waitFor(() => useStore.getState().savedTradeViews.some(view =>
      view.id === original.id && view.name === original.name && view.pinned === original.pinned &&
      view.pathname === original.pathname && view.search.symbol === original.search.symbol
    ), '撤销后未恢复原保存视图及其筛选与固定状态')
    const restoredSidebar = useStore.getState().display.sidebarWorkspaceItems
    if (JSON.stringify(restoredSidebar) !== JSON.stringify(beforeDelete)) throw Error('撤销后侧栏入口、位置或其他入口发生变化')
  } finally {
    root.unmount()
  }
}

window.__journalTabOverflowTest = run()

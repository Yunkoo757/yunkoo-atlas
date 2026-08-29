import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { TradeWorkspaceContext } from '@/components/TradeWorkspaceContext'
import type { TradeWorkspacePage } from '@/lib/tradeWorkspaceQuery'
import { useShortcutHost } from '@/shortcuts/ShortcutHost'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/components/Sidebar.css'

declare global {
  interface Window {
    __tradeWorkspaceContextTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

function Fixture() {
  useShortcutHost({ onToggleCmdk: () => {} })
  const location = useLocation()
  const page: TradeWorkspacePage = location.pathname === '/dashboard'
    ? 'stats'
    : location.pathname === '/weekly-review'
      ? 'review'
      : 'log'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '244px 1fr' }}>
      <Sidebar />
      <main>
        <TradeWorkspaceContext page={page} />
        <output data-testid="location">{location.pathname}{location.search}</output>
      </main>
    </div>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const root = createRoot(rootElement)

  try {
    useStore.setState({
      liveStages: [
        { id: 'stage-old', sequence: 1, name: '第二阶段', status: 'archived', startsOn: '2026-01-01', endsOn: '2026-06-30', createdAt: '2026-01-01T00:00:00.000Z', archivedAt: '2026-07-01T00:00:00.000Z' },
        { id: 'stage-current', sequence: 2, name: '当前阶段', status: 'current', startsOn: '2026-07-01', endsOn: null, createdAt: '2026-07-01T00:00:00.000Z', archivedAt: null },
      ],
      currentLiveStageId: 'stage-current',
      display: {
        ...previous.display,
        sidebarWorkspaceItems: [{
          id: 'system:paper',
          target: { kind: 'system', id: 'paper' },
          placement: 'pinned',
          order: 0,
        }],
        workspaceMemory: {
          ...previous.display.workspaceMemory,
          trade: {
            pathname: '/list',
            search: '?liveStage=stage-old&status=loss',
          },
          case: {
            pathname: '/review-cases',
            search: '',
          },
        },
      },
    })
    useShortcutStore.setState({
      bindings: {
        ...previousShortcuts.bindings,
        'nav.list': { key: 'a' },
        'nav.dashboard': { key: 'd' },
      },
      listContext: {
        listPath: '/list',
        listSearch: '?liveStage=stage-old&status=loss',
        orderedIds: [],
        filter: { type: 'all', tradeKind: 'live' },
      },
    })
    root.render(
      <MemoryRouter initialEntries={['/list?liveStage=stage-old&status=loss']}>
        <Routes><Route path="*" element={<Fixture />} /></Routes>
      </MemoryRouter>,
    )

    await waitFor(() => document.body.textContent?.includes('第二阶段') ?? false, '历史阶段没有进入公共上下文')
    const paperWorkspace = document.querySelector<HTMLAnchorElement>('[data-sidebar-workspace-id="system:paper"] > a')
    assert(
      paperWorkspace?.getAttribute('href') === '/sim?liveStage=stage-old',
      '侧栏模拟盘入口必须继承当前阶段范围',
    )
    const kindButtons = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="记录类型"] button')]
    const paperButton = kindButtons.find((button) => button.textContent?.trim() === '模拟')
    const liveButton = kindButtons.find((button) => button.textContent?.trim() === '实盘')
    paperButton?.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/list?liveStage=stage-old&status=loss&kind=paper',
      '切换模拟盘必须保留已选择的阶段范围',
    )
    liveButton?.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/list?liveStage=stage-old&status=loss',
      '从模拟盘切回实盘必须恢复同一个阶段范围',
    )
    const stats = document.querySelector<HTMLAnchorElement>('a[data-primary-id="dashboard"]')
    assert(stats?.getAttribute('href') === '/dashboard?liveStage=stage-old', '统计入口必须只继承公共上下文')
    stats.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?liveStage=stage-old',
      '统计分析必须一步到达并保留历史阶段',
    )
    assert(stats.getAttribute('aria-current') === 'page', '统计分析必须成为唯一一级选中项')

    const stageSelect = document.querySelector<HTMLButtonElement>('[aria-label^="选择交易阶段"]')
    stageSelect?.click()
    await waitFor(() => Boolean(document.querySelector('[role="option"][data-value="all"]')), '阶段菜单没有打开')
    document.querySelector<HTMLButtonElement>('[role="option"][data-value="all"]')?.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?liveStage=all',
      '统计分析选择全部阶段后必须更新公共范围',
    )
    assert(
      useStore.getState().display.workspaceMemory?.trade?.search === '?status=loss&liveStage=all',
      '统计分析修改阶段后必须写回交易工作区记忆',
    )

    const review = document.querySelector<HTMLAnchorElement>('a[data-primary-id="weeklyReview"]')
    review?.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/weekly-review?liveStage=all',
      '周期复盘必须一步到达并保留阶段上下文',
    )
    assert(!document.querySelector('[data-workspace-page="review"] [aria-label="记录类型"]'), '周期复盘不得展示无效盘型筛选')

    const cases = document.querySelector<HTMLAnchorElement>('a[data-primary-id="reviewCases"]')
    cases?.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/review-cases',
      '案例库必须一步到达',
    )

    useShortcutStore.setState({
      listContext: {
        listPath: '/review-cases/mistakes',
        listSearch: '?tag=执行',
        orderedIds: [],
        filter: { type: 'all', tradeKind: 'case' },
      },
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/dashboard?liveStage=all',
      '从案例库按统计分析快捷键时必须恢复共享阶段记忆',
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/list?liveStage=all',
      '从统计分析按 A 返回交易日志时必须保留阶段并清除临时筛选',
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/dashboard?liveStage=all',
      '统计分析快捷键必须继承交易日志的阶段记忆',
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent ===
        '/list?liveStage=all',
      '重复使用 A / D 后仍必须恢复阶段范围且不恢复临时筛选',
    )
  } finally {
    root.unmount()
    useStore.setState(previous, true)
    useShortcutStore.setState({
      bindings: previousShortcuts.bindings,
      listContext: previousShortcuts.listContext,
    })
  }
}

window.__tradeWorkspaceContextTest = run()

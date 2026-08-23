import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { TradeWorkspaceContext } from '@/components/TradeWorkspaceContext'
import type { TradeWorkspacePage } from '@/lib/tradeWorkspaceQuery'
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
  const root = createRoot(rootElement)

  try {
    useStore.setState({
      liveStages: [
        { id: 'stage-old', sequence: 1, name: '第二阶段', status: 'archived', startsOn: '2026-01-01', endsOn: '2026-06-30', createdAt: '2026-01-01T00:00:00.000Z', archivedAt: '2026-07-01T00:00:00.000Z' },
        { id: 'stage-current', sequence: 2, name: '当前阶段', status: 'current', startsOn: '2026-07-01', endsOn: null, createdAt: '2026-07-01T00:00:00.000Z', archivedAt: null },
      ],
      currentLiveStageId: 'stage-current',
    })
    root.render(
      <MemoryRouter initialEntries={['/list?liveStage=stage-old&status=loss']}>
        <Routes><Route path="*" element={<Fixture />} /></Routes>
      </MemoryRouter>,
    )

    await waitFor(() => document.body.textContent?.includes('第二阶段') ?? false, '历史阶段没有进入公共上下文')
    const stats = document.querySelector<HTMLAnchorElement>('[data-primary-id="dashboard"]')
    assert(stats?.getAttribute('href') === '/dashboard?liveStage=stage-old', '统计入口必须只继承公共上下文')
    stats.click()
    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/dashboard?liveStage=stage-old',
      '统计分析必须一步到达并保留历史阶段',
    )
    assert(stats.getAttribute('aria-current') === 'page', '统计分析必须成为唯一一级选中项')

    const review = document.querySelector<HTMLAnchorElement>('[data-primary-id="weeklyReview"]')
    review?.click()
    await waitFor(
      () => document.querySelector('[data-workspace-page="review"]')?.textContent?.includes('实盘复盘') ?? false,
      '周期复盘必须一步到达并说明实盘语义',
    )
    assert(!document.querySelector('[data-workspace-page="review"] [aria-label="记录类型"]'), '周期复盘不得展示无效盘型筛选')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__tradeWorkspaceContextTest = run()

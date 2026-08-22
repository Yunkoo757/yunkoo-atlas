import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { LiveArchiveView } from '@/views/LiveArchiveView'

declare global {
  interface Window {
    __liveArchiveModeHierarchyTest?: Promise<void>
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function waitFor(check: () => boolean, message: string) {
  for (let index = 0; index < 120; index += 1) {
    if (check()) return
    await frame()
  }
  throw new Error(message)
}

function trade(id: string, tradeKind: 'live' | 'case', sourceTradeId?: string): Trade {
  return {
    id,
    ref: tradeKind === 'case' ? 'CASE-HISTORY' : 'TRD-HISTORY',
    symbol: 'EURUSD',
    side: 'long',
    status: 'loss',
    conviction: 'medium',
    strategyId: 'strategy',
    tradeKind,
    liveStageId: 'stage-old',
    sourceTradeId,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 1.08,
    exit: 1.07,
    size: 1,
    pnl: -100,
    rMultiple: -1,
    openedAt: '2026-01-15',
    closedAt: '2026-01-15',
    closedTradingDayKey: '2026-01-15',
    note: '',
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-route>{`${location.pathname}${location.search}`}</output>
}

async function run() {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)
  const archivedTrade = trade('historical-trade', 'live')

  try {
    useStore.setState((state) => ({
      trades: [archivedTrade, trade('historical-case', 'case', archivedTrade.id)],
      strategies: [{ id: 'strategy', name: '测试策略', icon: 'target', color: '#5e6ad2' }],
      liveStages: [
        { id: 'stage-old', sequence: 1, name: '历史阶段', status: 'archived', startsOn: '2026-01-01', endsOn: '2026-01-31', createdAt: '2026-01-01T00:00:00.000Z', archivedAt: '2026-02-01T00:00:00.000Z' },
        { id: 'stage-current', sequence: 2, name: '当前阶段', status: 'current', startsOn: '2026-02-01', endsOn: null, createdAt: '2026-02-01T00:00:00.000Z', archivedAt: null },
      ],
      currentLiveStageId: 'stage-current',
      display: { ...state.display, hideClosed: false },
    }))

    root.render(
      <MemoryRouter initialEntries={['/live-history?liveStage=stage-old&tab=live']}>
        <Routes>
          <Route path="/live-history" element={<><LiveArchiveView /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => Boolean(document.querySelector('[data-trade-id="historical-trade"]')), '历史实盘未显示归档交易')
    const modeGroup = document.querySelector<HTMLElement>('[role="tablist"][aria-label="历史阶段内容"]')
    const filterShell = document.querySelector<HTMLElement>('.ui-filter-shell')
    assert(modeGroup && filterShell, '历史实盘缺少内容切换或筛选栏')
    assert(!filterShell.contains(modeGroup), '阶段内容 tab 不得混入筛选栏')
    assert((modeGroup.compareDocumentPosition(filterShell) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, '内容切换必须位于快捷筛选之前')

    const caseButton = [...modeGroup.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '关联案例')
    assert(caseButton, '内容切换缺少关联案例')
    caseButton.click()
    await waitFor(() => document.querySelector('[data-route]')?.textContent === '/live-history?liveStage=stage-old&tab=cases', '关联案例没有保留 stage 并更新内容 tab')
    await waitFor(() => Boolean(document.querySelector('[data-trade-id="historical-case"]')), '关联案例没有复用工作台列表')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      liveStages: previous.liveStages,
      currentLiveStageId: previous.currentLiveStageId,
      display: previous.display,
    })
  }
}

window.__liveArchiveModeHierarchyTest = run()

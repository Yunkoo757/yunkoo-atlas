import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Trade, TradeStatus } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { BoardView } from '@/views/BoardView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __boardViewVisualContractTest?: Promise<void>
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

function caseTrade(status: TradeStatus, index: number, currentLiveStageId: string): Trade {
  return {
    id: `case-${status}`,
    ref: `CAS-${index}`,
    symbol: index % 2 === 0 ? 'XAUUSD' : 'EURUSD',
    side: index % 2 === 0 ? 'long' : 'short',
    status,
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'case',
    caseType: status === 'loss' ? 'mistake' : 'exemplar',
    tags: ['伦敦盘', 'MTF ORA'],
    mistakeTags: status === 'loss' ? ['着急入场'] : [],
    reviewStatus: 'unreviewed',
    reviewCategory: status === 'loss' ? 'mistake' : 'normal',
    entry: 1.1,
    exit: 1.2,
    size: 1,
    pnl: 350,
    rMultiple: status === 'loss' ? -1 : 4.3,
    resultSource: 'r',
    openedAt: '2026-08-24',
    closedAt: status === 'planned' || status === 'open' ? null : '2026-08-24',
    closedTradingDayKey: status === 'planned' || status === 'open' ? undefined : '2026-08-24',
    liveStageId: currentLiveStageId,
    note: '',
  }
}

async function run(): Promise<void> {
  const host = document.getElementById('root')
  assert(host, '缺少测试挂载节点')
  const preview = new URLSearchParams(window.location.search).has('preview')
  const previous = useStore.getState()
  const root = createRoot(host)

  try {
    const currentLiveStageId = previous.currentLiveStageId
    useStore.setState((state) => ({
      trades: (['planned', 'missed', 'win', 'breakeven', 'loss'] as TradeStatus[])
        .map((status, index) => caseTrade(status, index + 1, currentLiveStageId)),
      display: { ...state.display, hideClosed: false, showEmptyGroups: false },
    }))

    root.render(
      <MemoryRouter initialEntries={['/review-cases/board']}>
        <main style={{ width: '1440px', height: '760px', display: 'flex', flexDirection: 'column' }}>
          <BoardView
            title="案例库"
            view="board"
            onView={() => undefined}
            onOpen={() => undefined}
            filter={{ type: 'all', tradeKind: 'case', reviewCaseScope: 'all' }}
          />
        </main>
      </MemoryRouter>,
    )

    await waitFor(() => document.querySelectorAll('.bd-col').length === 5, '五个状态列未完整渲染')
    await waitFor(() => document.querySelectorAll('.bd-card').length === 5, '案例卡片未完整渲染')

    const board = document.querySelector<HTMLElement>('.board-scroll')
    const columns = [...document.querySelectorAll<HTMLElement>('.bd-col')]
    const cards = [...document.querySelectorAll<HTMLElement>('.bd-card')]
    assert(board, '缺少案例看板滚动容器')
    assert(!document.querySelector('.board-scroll-case, .bd-card-case'), '案例库不得启用第二套看板视觉分支')
    assert(getComputedStyle(board).gap === '0px', '看板列之间不得保留卡片式沟槽')
    assert(columns.every((column) => getComputedStyle(column).borderRadius === '0px'), '状态列不得继续使用独立大圆角容器')
    assert(columns.every((column) => getComputedStyle(column).backgroundColor === 'rgba(0, 0, 0, 0)'), '状态列必须共享页面底色')
    assert(getComputedStyle(columns[1]!).borderLeftWidth === '1px', '相邻状态列应以轻分隔线建立结构')
    assert(cards.every((card) => card.getBoundingClientRect().width > 240), '案例卡片宽度不应因内外双层容器被过度压缩')
    assert(document.querySelectorAll('.bd-card-result').length === 5, '每张卡片应只保留一个列表同源结果值')
    assert(!document.body.textContent?.includes('$350'), '看板不得重新引入列表已经移除的现金金额')
  } finally {
    if (!preview) {
      root.unmount()
      useStore.setState(previous, true)
    }
  }
}

window.__boardViewVisualContractTest = run()

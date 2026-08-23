import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import type { Trade } from '@/data/trades'
import { toLocalDateKey } from '@/lib/tradeWorkflow'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __sidebarTodayLiveScopeTest?: Promise<void>
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

const legacyPlan: Trade = {
  id: 'legacy-plan',
  ref: 'TRD-1',
  symbol: 'EURUSD',
  side: 'long',
  status: 'planned',
  conviction: 'medium',
  strategyId: 'uncategorized',
  timeframe: '4H',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  tradeKind: 'live',
  liveStageId: 'stage-old',
  entry: 1.1,
  exit: null,
  stopLoss: 1.09,
  size: 1,
  pnl: null,
  rMultiple: null,
  openedAt: '2000-01-01',
  closedAt: null,
  note: '',
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  const today = toLocalDateKey()
  const currentPlan: Trade = {
    ...legacyPlan,
    id: 'current-plan',
    ref: 'TRD-2',
    tradeKind: 'live',
    liveStageId: previous.currentLiveStageId,
  }

  try {
    useStore.setState((state) => ({
      trades: [legacyPlan, currentPlan],
      strategies: [],
      savedTradeViews: [],
      display: {
        ...state.display,
        tradingDayStartHour: 0,
        sidebarWorkspaceItems: [],
      },
    }))

    root.render(
      <MemoryRouter initialEntries={['/today-record']}>
        <Sidebar />
      </MemoryRouter>,
    )

    await waitFor(
      () => document.querySelector('[data-primary-id="trades"] .sb-item-count') !== null,
      '交易日志侧栏计数没有渲染',
    )
    const count = document.querySelector<HTMLElement>('[data-primary-id="trades"] .sb-item-count')
    assert(count, '缺少交易日志侧栏计数')
    assert(count.textContent?.trim() === '1', '交易日志侧栏只能统计 currentLiveStageId，旧 stage 日期不得干扰')
    assert(count.getAttribute('aria-hidden') === 'false', '当前 stage 有待办时计数必须可见')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__sidebarTodayLiveScopeTest = run()

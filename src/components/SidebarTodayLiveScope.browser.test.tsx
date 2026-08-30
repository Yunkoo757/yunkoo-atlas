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
  const focusCase: Trade = {
    ...legacyPlan,
    id: 'focus-case',
    ref: 'CAS-1',
    tradeKind: 'case',
    liveStageId: undefined,
    reviewCategory: 'focus',
  }
  const normalCase: Trade = {
    ...focusCase,
    id: 'normal-case',
    ref: 'CAS-2',
    reviewCategory: 'normal',
  }

  try {
    useStore.setState((state) => ({
      trades: [legacyPlan, currentPlan, focusCase, normalCase],
      strategies: [],
      savedTradeViews: [],
      display: {
        ...state.display,
        tradingDayStartHour: 0,
        sidebarWorkspaceItems: [],
        workspaceMemory: {
          ...state.display.workspaceMemory,
          trade: { pathname: '/list', search: '?period=this-week' },
          case: { pathname: '/review-cases/focus', search: '' },
        },
      },
    }))

    root.render(
      <MemoryRouter initialEntries={['/today-record']}>
        <Sidebar />
      </MemoryRouter>,
    )

    await waitFor(() => document.querySelector('[data-primary-id="trades"]') !== null, '交易日志侧栏入口没有渲染')
    assert(document.querySelector('.sb-item-count') === null, '左侧导航不应继续显示记录计数')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__sidebarTodayLiveScopeTest = run()

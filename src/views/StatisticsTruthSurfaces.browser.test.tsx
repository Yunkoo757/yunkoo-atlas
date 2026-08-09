import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { StrategyHeader } from '@/components/StrategyHeader'
import { useStore } from '@/store/useStore'
import { TodayWorkspace } from '@/views/TodayWorkspace'
import { WeeklyReviewView } from '@/views/WeeklyReviewView'
import { StrategiesPanel } from '@/views/settings/StrategiesPanel'

declare global {
  interface Window {
    __statisticsTruthSurfacesTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function installCurrentDate(initialNow: number) {
  const NativeDate = globalThis.Date
  let currentNow = initialNow
  const ShiftedDate = new Proxy(NativeDate, {
    construct(target, argumentsList) {
      return argumentsList.length > 0
        ? Reflect.construct(target, argumentsList)
        : new target(currentNow)
    },
    get(target, property, receiver) {
      if (property === 'now') return () => currentNow
      return Reflect.get(target, property, receiver)
    },
  })
  globalThis.Date = ShiftedDate as DateConstructor
  return {
    set(nextNow: number) { currentNow = nextNow },
    restore() { globalThis.Date = NativeDate },
  }
}

const strategy: Strategy = {
  id: 'truth-strategy',
  name: '真值策略',
  icon: 'target',
  color: '#5e6ad2',
}

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: 'truth-valid',
    ref: 'TRD-TRUTH-VALID',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: strategy.id,
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: 2,
    resultSource: 'imported',
    openedAt: '2026-08-09',
    closedAt: '2026-08-09',
    closedTradingDayKey: '2026-08-09',
    note: '',
    ...overrides,
  }
}

function truthTrades(): Trade[] {
  return [
    trade({}),
    trade({
      id: 'truth-0559',
      ref: 'TRD-0559',
      openedAt: '2026-08-08',
      closedAt: '2026-08-08',
      closedTradingDayKey: '2026-08-08',
    }),
    trade({ id: 'truth-missing', ref: 'TRD-MISSING', closedAt: null, closedTradingDayKey: undefined }),
    trade({
      id: 'truth-invalid',
      ref: 'TRD-INVALID',
      closedAt: '2026-02-30',
      closedTradingDayKey: undefined,
    }),
    trade({ id: 'truth-future', ref: 'TRD-FUTURE', closedTradingDayKey: '2026-08-10', pnl: 900, rMultiple: 9 }),
    trade({ id: 'truth-conflict', ref: 'TRD-CONFLICT', pnl: -500, rMultiple: 1 }),
    trade({ id: 'truth-cny', ref: 'TRD-CNY', pnl: 700, cashCurrency: 'CNY', rMultiple: 3 }),
    trade({ id: 'truth-r-only', ref: 'TRD-R', pnl: null, cashCurrency: null, rMultiple: 4, resultSource: 'r' }),
  ]
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
    // 使用本地正午，避免 CI（UTC）把 +08:00 锚点解析到前一交易日。
    const date = installCurrentDate(new Date('2026-08-09T12:00:00').getTime())
  const root = createRoot(rootElement)

  try {
    useStore.setState({
      trades: truthTrades(),
      strategies: [strategy],
      livePerformanceCycles: [{
        id: 'truth-current',
        name: '当前段',
        startTradingDayKey: '2026-08-01',
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
      profile: { ...previous.profile, legacyCashCurrencyAssumption: null },
      display: { ...previous.display, tradingDayStartHour: 6 },
    })
    root.render(<MemoryRouter><TodayWorkspace /></MemoryRouter>)
    await waitFor(() => document.querySelector('.today-stats') !== null, 'Today 真值条未渲染')
    const todayText = document.querySelector('.today-stats')?.textContent ?? ''
    assert(todayText.includes('今日平仓3'), 'Today renderer 必须只显示三笔可靠完整今日结果')
    assert(todayText.includes('+$100') && !todayText.includes('$900'), 'Today renderer 的 USD 总计必须只消费 pnlIds')

    root.render(
      <MemoryRouter>
        <StrategyHeader strategyId={strategy.id} />
      </MemoryRouter>,
    )
    await waitFor(() => document.querySelector('.sh') !== null, 'StrategyHeader 未渲染')
    const headerText = document.querySelector('.sh')?.textContent ?? ''
    assert(headerText.includes('6 笔当前实盘关联 · 4 笔绩效样本'), `StrategyHeader 必须分开关联数与资格样本数：${headerText}`)
    assert(headerText.includes('+$200') && headerText.includes('+11.0R'), 'StrategyHeader 必须分别消费 pnlIds 与 rIds')

    root.render(<MemoryRouter><StrategiesPanel /></MemoryRouter>)
    await waitFor(() => document.querySelector('.st-row') !== null, 'StrategiesPanel 未渲染')
    const panelText = document.querySelector('.st-row')?.textContent ?? ''
    assert(panelText.includes('6 笔当前实盘关联 · 4 笔绩效样本'), 'StrategiesPanel 必须分开关联数与资格样本数')
    assert(panelText.includes('+11.0R') && !panelText.includes('900'), 'StrategiesPanel 不得纳入未来或冲突绩效')

    date.set(new Date('2026-08-04T12:00:00').getTime())
    useStore.setState({
      trades: [
        trade({ id: 'weekly-valid', ref: 'TRD-WEEKLY-VALID', openedAt: '2026-08-03', closedAt: '2026-08-03', closedTradingDayKey: '2026-08-03' }),
        trade({ id: 'weekly-conflict', ref: 'TRD-WEEKLY-CONFLICT', status: 'win', openedAt: '2026-08-03', closedAt: '2026-08-03', closedTradingDayKey: '2026-08-03', pnl: -500, rMultiple: 1, resultSource: 'imported' }),
        trade({ id: 'weekly-pending', ref: 'TRD-WEEKLY-PENDING', status: 'win', openedAt: '2026-08-03', closedAt: '2026-08-03', closedTradingDayKey: '2026-08-03', pnl: null, rMultiple: null, resultSource: undefined }),
        trade({ id: 'FX-CLOSE-FUTURE', ref: 'TRD-WEEKLY-FUTURE', openedAt: '2026-08-05', closedAt: '2026-08-05', closedTradingDayKey: '2026-08-05', pnl: 900 }),
        trade({ id: 'weekly-missed', ref: 'TRD-WEEKLY-MISSED', status: 'missed', openedAt: '2026-08-03', closedAt: '2026-08-03', closedTradingDayKey: '2026-08-03', pnl: null, rMultiple: null, resultSource: undefined, missReason: 'hesitation' }),
      ],
      weeklyReviews: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      riskOverrideEvents: [],
    })
    root.render(<MemoryRouter><WeeklyReviewView /></MemoryRouter>)
    await waitFor(() => document.querySelector('.wr-trade-row') !== null, 'WeeklyReviewView 证据未渲染')
    const weeklyText = document.body.textContent ?? ''
    assert(weeklyText.includes('+$100') && !weeklyText.includes('TRD-WEEKLY-FUTURE'), 'Weekly renderer 必须冻结在当前业务日')
    assert(weeklyText.includes('1 笔结果口径冲突') && weeklyText.includes('1 笔待补结果'), 'Weekly renderer 必须显示 conflict/pending 告警')
    assert(weeklyText.includes('TRD-WEEKLY-CONFLICT') && weeklyText.includes('TRD-WEEKLY-PENDING'), 'Weekly renderer 必须保留 conflict/pending 事实证据')
    assert(document.querySelectorAll('.wr-trade-row').length === 4, 'Weekly evidence 应保留完整、冲突、待补与独立 missed evidence')
  } finally {
    root.unmount()
    date.restore()
    useStore.setState(previous)
  }
}

window.__statisticsTruthSurfacesTest = run()

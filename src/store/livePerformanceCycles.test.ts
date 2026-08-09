import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { buildLivePerformanceRestartPreview, useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const first: LivePerformanceCycle = {
  id: 'cycle-store-first',
  name: '首个周期',
  startTradingDayKey: '2026-08-01',
  createdAt: '2026-08-01T00:00:00.000Z',
}

function closedLiveTrade(id: string, day: string, patch: Partial<Trade> = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: day,
    closedAt: day,
    closedTradingDayKey: day,
    note: '',
    ...patch,
  }
}

export function testRestartPreviewCountsArchiveCurrentActivePendingAndCases(): void {
  const trades: Trade[] = [
    closedLiveTrade('archived-valid', '2026-08-02'),
    closedLiveTrade('archived-conflict', '2026-08-02', { pnl: 10, rMultiple: -1 }),
    closedLiveTrade('archived-missing-result', '2026-08-02', { pnl: null, rMultiple: null, resultSource: undefined }),
    closedLiveTrade('current-on-start', '2026-08-05'),
    closedLiveTrade('pending-close-day', '2026-08-04', { closedTradingDayKey: 'invalid' }),
    { ...closedLiveTrade('active-open', '2026-08-05'), status: 'open' as const, exit: null, pnl: null, rMultiple: null, resultSource: undefined, closedAt: null },
    { ...closedLiveTrade('legacy-open', '2026-08-02'), status: 'open' as const, exit: null, pnl: null, rMultiple: null, resultSource: undefined, closedAt: null },
    { ...closedLiveTrade('pending-planned', '2026-08-05'), status: 'planned' as const, exit: null, pnl: null, rMultiple: null, resultSource: undefined, closedAt: null },
    { ...closedLiveTrade('case-for-archive', '2026-08-02'), tradeKind: 'case', sourceTradeId: 'archived-valid' },
  ]

  const preview = buildLivePerformanceRestartPreview(trades, [first], '2026-08-05', 0)

  assert(preview.startTradingDayKey === '2026-08-05', '预览必须回显所选业务日起点')
  assert(preview.archivedClosedCount === 3, '起点前已结束实盘必须计入统一历史，结果冲突和缺结果不得丢失')
  assert(preview.currentClosedCount === 1, '起点当天已平仓的有效实盘必须保留在当前')
  assert(preview.activeCount === 2, '仅开仓日在起点后的计划/持仓计入当前进行中')
  assert(preview.pendingCount === 1, '缺有效平仓日的已结束实盘必须计入待整理，计划中不得冒充待整理')
  assert(preview.associatedCaseCount === 1, '来源于将进入历史的实盘的案例必须被计数')
}

export function testResetLiveStatisticsClearsRiskAndCollapsesCycles(): void {
  const previous = useStore.getState()
  const seedTrades = [
    closedLiveTrade('keep-live', '2026-08-02'),
    closedLiveTrade('keep-case', '2026-08-02', { tradeKind: 'case', sourceTradeId: 'keep-live' }),
  ]
  try {
    useStore.setState({
      trades: seedTrades,
      livePerformanceCycles: [
        first,
        { id: 'cycle-store-second', name: '第二周期', startTradingDayKey: '2026-08-03', createdAt: '2026-08-03T00:00:00.000Z' },
      ],
      liveStatsStartTradingDayKey: '2026-07-01',
      weeklyRiskPreparations: [{
        id: 'prep-1',
        weekStart: '2026-08-03',
        draft: {
          capitalBase: 10000,
          riskPercent: 1,
          riskAmount: 100,
          dailyLossLimitR: 2,
          weeklyLossLimitR: 5,
          monthlyLossLimitRDefault: 10,
          disciplineText: '',
        },
        reviewedAt: null,
        confirmedPolicyVersionId: null,
        createdAt: '2026-08-03T00:00:00.000Z',
        updatedAt: '2026-08-03T00:00:00.000Z',
      }],
      riskPolicyVersions: [{
        id: 'policy-1',
        sourceWeekStart: '2026-08-03',
        effectiveTradingDay: '2026-08-03',
        capitalBase: 10000,
        riskPercent: 1,
        riskAmount: 100,
        dailyLossLimitR: 2,
        weeklyLossLimitR: 5,
        monthlyLossLimitRDefault: 10,
        disciplineText: '',
        confirmedAt: '2026-08-03T00:00:00.000Z',
      }],
      monthlyRiskLimits: [{
        id: 'month-1',
        monthKey: '2026-08',
        limitR: 10,
        sourcePolicyVersionId: 'policy-1',
        lockedAt: '2026-08-03T00:00:00.000Z',
      }],
      riskOverrideEvents: [],
    })

    useStore.getState().resetLiveStatistics('2026-08-05', '2026-08-09')
    const state = useStore.getState()
    assert(state.livePerformanceCycles.length === 1, '重置后只保留一条当前起点')
    assert(state.livePerformanceCycles[0]?.startTradingDayKey === '2026-08-05', '重置起点必须写入绩效边界')
    assert(state.liveStatsStartTradingDayKey === '2026-08-05', '风险起算必须同步到同一天')
    assert(state.weeklyRiskPreparations.length === 0, '周风险准备必须清空')
    assert(state.riskPolicyVersions.length === 0, '风险政策版本必须清空')
    assert(state.monthlyRiskLimits.length === 0, '月度限额必须清空')
    assert(JSON.stringify(state.trades) === JSON.stringify(seedTrades), '重置不得改动交易与案例实体')
  } finally {
    useStore.setState(previous)
  }
}

export function testLivePerformanceCycleStoreActionsDoNotModifyTradesOrReviews(): void {
  const previous = useStore.getState()
  const beforeTrades = JSON.stringify(previous.trades)
  const beforeReviews = JSON.stringify(previous.weeklyReviews)
  try {
    useStore.setState({
      livePerformanceCycles: [],
      liveStatsStartTradingDayKey: '2026-07-01',
    })

    useStore.getState().createLivePerformanceCycle(first, '2026-08-05')
    assert(useStore.getState().livePerformanceCycles[0]?.id === first.id, '创建必须写入第一个周期')

    useStore.getState().renameLivePerformanceCycle(first.id, '新名称')
    assert(useStore.getState().livePerformanceCycles[0]?.name === '新名称', '重命名必须更新周期名称')

    useStore.getState().undoLatestLivePerformanceCycle()
    assert(useStore.getState().livePerformanceCycles.length === 0, '撤销必须移除最新周期')
    assert(JSON.stringify(useStore.getState().trades) === beforeTrades, '周期操作不得修改交易')
    assert(JSON.stringify(useStore.getState().weeklyReviews) === beforeReviews, '周期操作不得修改周复盘')
    assert(useStore.getState().liveStatsStartTradingDayKey === '2026-07-01', '周期操作不得修改风险起点')
  } finally {
    useStore.setState(previous)
  }
}

export function testReplaceLivePerformanceCyclesValidatesAndClonesInput(): void {
  const previous = useStore.getState()
  try {
    const cycles = [{ ...first }]
    useStore.getState().replaceLivePerformanceCycles(cycles)
    cycles[0]!.name = '外部变更'
    assert(useStore.getState().livePerformanceCycles[0]?.name === first.name, '替换必须克隆输入周期')
  } finally {
    useStore.setState(previous)
  }
}

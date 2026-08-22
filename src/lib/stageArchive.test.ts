import type { Trade } from '@/data/trades'
import {
  buildStageArchiveOverview,
  buildStageArchiveSummary,
  buildStagePerformanceProjection,
  filterStageTrades,
  resolveStrategyStageScope,
  resolveStageScope,
} from '@/lib/stageArchive'
import type { LiveStage } from '@/lib/liveStages'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function liveTrade(id: string, liveStageId: string | null): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy',
    tradeKind: 'live',
    liveStageId,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: '2026-01-10',
    closedAt: '2026-01-10',
    closedTradingDayKey: '2026-01-10',
    note: '',
  }
}

const stages: LiveStage[] = [
  {
    id: 'stage-old',
    sequence: 1,
    name: '实盘阶段 1',
    status: 'archived',
    startsOn: '2026-01-01',
    endsOn: '2026-01-31',
    createdAt: '2026-01-01T00:00:00.000Z',
    archivedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'stage-current',
    sequence: 2,
    name: '实盘阶段 2',
    status: 'current',
    startsOn: '2026-02-01',
    endsOn: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    archivedAt: null,
  },
]

export function testDateEditCannotMoveHistoricalRecordIntoCurrentProjection(): void {
  const edited = {
    ...liveTrade('historical', 'stage-old'),
    openedAt: '2027-01-01',
    closedAt: '2027-01-02',
    closedTradingDayKey: '2027-01-02',
  }

  assert(
    filterStageTrades([edited], { kind: 'current', stageId: 'stage-current' }).length === 0,
    '日期编辑不得把历史记录迁入当前投影',
  )
  assert(
    filterStageTrades([edited], { kind: 'stage', stageId: 'stage-old' }).length === 1,
    '历史记录必须继续属于原 stage ID',
  )
}

export function testAllHistoryExcludesCurrentAndPending(): void {
  const result = filterStageTrades([
    liveTrade('archived', 'stage-old'),
    liveTrade('current', 'stage-current'),
    liveTrade('pending', null),
  ], { kind: 'all-history', archivedStageIds: new Set(['stage-old']) })

  assert(result.map((trade) => trade.id).join() === 'archived', '全部历史只能包含已归档 stage ID')
}

export function testPendingIncludesOnlyExplicitNullOwnership(): void {
  const legacyUndefined = { ...liveTrade('legacy-undefined', null), liveStageId: undefined }
  const pending = liveTrade('pending', null)

  const result = filterStageTrades([legacyUndefined, pending], { kind: 'pending' })

  assert(result.map((trade) => trade.id).join() === 'pending', '运行时 pending 只能包含显式 null 归属')
}

export function testHistoryScopeFallsBackSafelyForInvalidAndCurrentIds(): void {
  const invalid = resolveStageScope('missing', stages, 'stage-current', 'history')
  const current = resolveStageScope('stage-current', stages, 'stage-current', 'history')

  assert(invalid.kind === 'all-history', '历史页非法 stage ID 必须回退全部历史')
  assert(current.kind === 'all-history', '历史页不得把当前 stage ID 当作历史阶段')
}

export function testArchiveSummaryRecomputesFromEditedHistoricalFacts(): void {
  const scope = { kind: 'stage' as const, stageId: 'stage-old' }
  const original = liveTrade('historical', 'stage-old')
  const edited = { ...original, pnl: 250, rMultiple: 2.5, status: 'win' as const }
  const unrelated = { ...liveTrade('current', 'stage-current'), pnl: 9999 }

  const before = buildStageArchiveSummary([original, unrelated], scope)
  const after = buildStageArchiveSummary([edited, unrelated], scope)

  assert(before.totalPnl === 100, '历史 overview 初始指标必须来自所选 stage 的当前事实')
  assert(after.totalPnl === 250 && after.averageR === 2.5, '编辑历史事实后 overview 必须实时重算')
}

const anchor = {
  now: new Date('2026-08-22T12:00:00.000Z'),
  tradingDayStartHour: 0,
  currentTradingDayKey: '2026-08-22',
}

export function testStagePerformanceMembershipIgnoresEditedDateDirection(): void {
  const historicalNewDate = {
    ...liveTrade('historical-new-date', 'stage-old'),
    pnl: 300,
    openedAt: '2026-08-21',
    closedAt: '2026-08-21',
    closedTradingDayKey: '2026-08-21',
  }
  const currentOldDate = {
    ...liveTrade('current-old-date', 'stage-current'),
    pnl: 40,
    openedAt: '2020-01-01',
    closedAt: '2020-01-01',
    closedTradingDayKey: '2020-01-01',
  }
  const trades = [historicalNewDate, currentOldDate]
  const current = buildStagePerformanceProjection({
    trades,
    stageScope: { kind: 'current', stageId: 'stage-current' },
    analysisScope: { kind: 'live', range: 'all' },
    anchor,
    legacyCashCurrencyAssumption: null,
  })
  const historical = buildStagePerformanceProjection({
    trades,
    stageScope: { kind: 'stage', stageId: 'stage-old' },
    analysisScope: { kind: 'live', range: 'all' },
    anchor,
    legacyCashCurrencyAssumption: null,
  })

  assert(current.records.map((trade) => trade.id).join() === 'current-old-date', '当前策略统计必须保留当前 stage 的旧日期记录')
  assert(current.selection.eligibleMetricIds.length === 1, '当前策略统计数值样本必须是 1')
  assert(historical.records.map((trade) => trade.id).join() === 'historical-new-date', '历史策略统计必须保留历史 stage 的新日期记录')
  assert(historical.selection.eligibleMetricIds.length === 1, '历史策略统计数值样本必须是 1')
}

export function testStageArchiveOverviewUsesUsdCoverageWithoutAddingUnlikeCurrencies(): void {
  const usd = { ...liveTrade('usd', 'stage-old'), pnl: 100, cashCurrency: 'USD' as const }
  const cny = { ...liveTrade('cny', 'stage-old'), pnl: 700, cashCurrency: 'CNY' as const }
  const unknown = { ...liveTrade('unknown', 'stage-old'), pnl: 50, cashCurrency: null }
  const overview = buildStageArchiveOverview({
    trades: [usd, cny, unknown],
    strategies: [{ id: 'strategy', name: '策略', icon: 'target', color: '#5e6ad2' }],
    stageScope: { kind: 'stage', stageId: 'stage-old' },
    anchor,
    legacyCashCurrencyAssumption: null,
  })

  assert(overview.stats.totalPnl === 100, '历史 overview 只能合并 USD，不得把 CNY/未知币种相加')
  assert(overview.performance.currencyMergeStatus === 'usd-with-exclusions', '混合币种必须暴露排除状态')
  assert(overview.performance.usdCoveredCount === 1, 'USD 覆盖数必须是 1')
  assert(overview.performance.excludedCurrencyCounts[0]?.currency === 'CNY', '必须明确报告排除的 CNY')
  assert(overview.performance.excludedUnknownCount === 1, '必须明确报告一个未知币种')
  assert(overview.strategyStats[0]?.totalPnl === 100, '策略 breakdown 也不得合并不同币种')
}

export function testPaperStrategyPreviewKeepsCurrentStageScope(): void {
  const stageScope = resolveStrategyStageScope(undefined, 'stage-current')
  const projection = buildStagePerformanceProjection({
    trades: [
      { ...liveTrade('current-live', 'stage-current'), pnl: 100 },
      { ...liveTrade('archived-live', 'stage-old'), pnl: 900 },
    ],
    stageScope,
    analysisScope: { kind: 'live', range: 'all' },
    anchor,
    legacyCashCurrencyAssumption: null,
  })

  assert(stageScope.kind === 'current', 'paper 列表策略预览必须保持基线 current 实盘口径')
  assert(projection.selection.pnlIds.join() === 'current-live', 'paper 列表策略预览不得扩大到归档 live stage')
}

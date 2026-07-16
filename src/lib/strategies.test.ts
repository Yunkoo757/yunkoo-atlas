import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import {
  computeStrategyStats,
  countStrategyReferences,
  ensureStrategies,
  formatStrategyMetricCoverage,
  normalizeTradeStrategyReferences,
} from '@/lib/strategies'
import { applyTradeUpsertsToSlice } from '@/store/useStore'

const strategyId = 'breakout'

const closedLiveTrade: Trade = {
  id: 'live-win',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId,
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 100,
  rMultiple: 2,
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testStrategyStatsExcludeDeletedTradesByDefault(): void {
  const deletedTrade: Trade = {
    ...closedLiveTrade,
    id: 'deleted-win',
    ref: 'TRD-2',
    pnl: 1_000,
    rMultiple: 10,
    deletedAt: '2026-07-03T00:00:00.000Z',
  }

  const stats = computeStrategyStats([closedLiveTrade, deletedTrade], strategyId)

  assert(stats.tradeCount === 1, 'deleted trades must not enter the strategy trade count')
  assert(stats.closedCount === 1, 'deleted trades must not enter the strategy closed count')
  assert(stats.totalPnl === 100, 'deleted trades must not enter strategy PnL')
  assert(stats.totalR === 2, 'deleted trades must not enter strategy R')
}

export function testStrategyStatsKeepMissingResultsUnknown(): void {
  const incompleteTrade: Trade = {
    ...closedLiveTrade,
    id: 'pending-result',
    ref: 'TRD-3',
    pnl: null,
    rMultiple: null,
  }

  const stats = computeStrategyStats([incompleteTrade], strategyId)

  assert(stats.closedCount === 1, 'an incomplete closed trade must remain visible as closed')
  assert(stats.winRate === null, 'missing results must not be reported as a zero win rate')
  assert(stats.averageR === null, 'missing R must not be reported as zero average R')
}

export function testStrategyStatsExposeResultCoverageWithoutInventingTotals(): void {
  const incompleteTrade: Trade = {
    ...closedLiveTrade,
    id: 'missing-metrics',
    ref: 'TRD-4',
    pnl: null,
    rMultiple: null,
  }

  const stats = computeStrategyStats([incompleteTrade], strategyId)

  assert(stats.evaluatedCount === 0, 'strategy stats must expose that no result is evaluable')
  assert(stats.pnlCount === 0, 'strategy stats must expose missing cash coverage')
  assert(stats.rCount === 0, 'strategy stats must expose missing R coverage')
  assert(stats.totalPnl === null, 'missing cash metrics must not become zero total PnL')
  assert(stats.totalR === null, 'missing R metrics must not become zero total R')
}

export function testStrategyReferenceCountIncludesRecordsOutsidePerformanceScope(): void {
  const paperTrade: Trade = {
    ...closedLiveTrade,
    id: 'paper-trade',
    ref: 'TRD-5',
    tradeKind: 'paper',
  }
  const reviewCase: Trade = {
    ...closedLiveTrade,
    id: 'review-case',
    ref: 'CAS-1',
    tradeKind: 'case',
  }
  const deletedTrade: Trade = {
    ...closedLiveTrade,
    id: 'deleted-trade',
    ref: 'TRD-6',
    deletedAt: '2026-07-03T00:00:00.000Z',
  }

  const count = countStrategyReferences(
    [closedLiveTrade, paperTrade, reviewCase, deletedTrade],
    strategyId,
  )

  assert(count === 4, 'strategy deletion must migrate every record that still references it')
}

export function testStrategyMetricCoverageCallsOutPartialTotals(): void {
  assert(
    formatStrategyMetricCoverage(1, 2) === '1/2 笔可用',
    '部分指标不得伪装成覆盖全部样本的总计',
  )
  assert(
    formatStrategyMetricCoverage(2, 2) === null,
    '完整覆盖时无需增加重复提示',
  )
}

export function testMalformedReviewTemplatesAreRemovedAtTheStoreBoundary(): void {
  const malformed = {
    id: strategyId,
    name: '突破',
    icon: 'target',
    color: '#5e6ad2',
    reviewTemplateHtml: 42,
  } as unknown as Strategy

  const [normalized] = ensureStrategies([malformed])

  assert(normalized?.reviewTemplateHtml === undefined, '异常模板字段不得进入运行时 store')
}

export function testExistingEmptyStrategyCollectionsStayEmpty(): void {
  assert(
    ensureStrategies([]).length === 0,
    '历史资料库明确保存的空策略集合不得被新库默认值覆盖',
  )
  assert(
    ensureStrategies(undefined).length > 0,
    '真正缺失策略字段的旧格式仍需获得可用的兼容默认值',
  )
}

export function testFirstTradeInHistoricalEmptyStrategyLibraryCreatesAValidReference(): void {
  const result = applyTradeUpsertsToSlice({
    trades: [],
    strategies: [],
    symbolCatalog: [],
    tagPresets: [],
    mistakeTagPresets: [],
  }, [{ ...closedLiveTrade, strategyId: 'missing-strategy' }])

  assert(result.strategies.length === 1, '首次新增记录时应为历史空策略库补一个中性策略')
  assert(
    result.strategies.some((strategy) => strategy.id === result.trades[0]?.strategyId),
    '新增记录的 strategyId 必须引用真实存在的策略',
  )
}

export function testSnapshotStrategyRepairOnlyMaterializesDefaultsWhenRecordsExist(): void {
  const empty = normalizeTradeStrategyReferences([], [])
  assert(empty.strategies.length === 0, '显式空策略的真正空库必须保持为空')

  const repaired = normalizeTradeStrategyReferences(
    [{ ...closedLiveTrade, strategyId: 'missing-strategy' }],
    [],
  )
  assert(repaired.strategies.length === 1, '有记录的空策略快照必须物化中性策略')
  assert(
    repaired.strategies.some((strategy) => strategy.id === repaired.trades[0]?.strategyId),
    '修复后的记录必须引用物化后的真实策略',
  )
}

export function testUnknownStrategyReferenceFallsBackToAnExistingStrategy(): void {
  const existing: Strategy = {
    id: 'existing-strategy',
    name: '已有策略',
    icon: 'target',
    color: '#5e6ad2',
  }
  const repaired = normalizeTradeStrategyReferences(
    [{ ...closedLiveTrade, strategyId: 'missing-strategy' }],
    [existing],
  )

  assert(repaired.strategies[0] === existing, '修复未知引用不得重写已有策略')
  assert(
    repaired.trades[0]?.strategyId === existing.id,
    '未知 strategyId 必须回退到真实存在的策略',
  )
}

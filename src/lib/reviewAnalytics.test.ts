import type { Trade } from '@/data/trades'
import {
  DEFAULT_REVIEW_STATUS,
  normalizeReviewFields,
  summarizeStrategyPerformance,
} from '@/lib/reviewAnalytics'
import { computeStrategyStats } from '@/lib/strategies'

const baseTrade: Trade = {
  id: 't1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'breakout',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: DEFAULT_REVIEW_STATUS,
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 100,
  rMultiple: 2,
  openedAt: '2026-06-01',
  closedAt: '2026-06-02',
  note: '',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testNormalizeReviewFields(): void {
  const legacy = {
    ...baseTrade,
    mistakeTags: undefined,
    reviewStatus: undefined,
  } as unknown as Trade
  const normalized = normalizeReviewFields(legacy)
  assert(normalized.reviewStatus === 'unreviewed', 'legacy trades default to unreviewed')
  assert(normalized.reviewCategory === 'normal', 'legacy trades default to normal category')
  assert(Array.isArray(normalized.mistakeTags), 'legacy trades get mistakeTags array')
  assert(normalized.timeframe === undefined, 'legacy trades without timeframe remain unset')
}

export function testSummarizeStrategyPerformance(): void {
  const trades: Trade[] = [
    baseTrade,
    {
      ...baseTrade,
      id: 't2',
      status: 'loss',
      pnl: -50,
      rMultiple: -1,
      mistakeTags: ['追单', '过早止盈'],
      reviewStatus: 'reviewed',
    },
    {
      ...baseTrade,
      id: 't3',
      status: 'open',
      pnl: 20,
      rMultiple: 0.5,
      mistakeTags: ['追单'],
      reviewStatus: 'focus',
    },
  ]
  const stats = summarizeStrategyPerformance(trades, 'breakout')
  assert(stats.tradeCount === 2, 'counts closed strategy analytics candidates')
  assert(stats.closedCount === 2, 'counts only executed closed trades')
  assert(stats.winRate === 50, 'computes win rate from closed trades')
  assert(stats.totalR === 1, 'sums closed-trade R multiples')
  assert(stats.averageR === 0.5, 'averages closed-trade R multiples')
  assert(stats.worstR === -1, 'finds worst closed-trade R multiple')
  assert(stats.topMistakes.some((item) => item.tag === '追单'), 'summarizes candidate mistake tags')
  assert(stats.reviewedCount === 1, 'counts review states from the same analytics candidates')
}

export function testStrategyPerformanceDefaultsToClosedLiveAnalyticsCandidates(): void {
  const trades: Trade[] = [
    baseTrade,
    {
      ...baseTrade,
      id: 'paper-loss',
      tradeKind: 'paper',
      status: 'loss',
      pnl: -100,
      rMultiple: -2,
    },
    {
      ...baseTrade,
      id: 'deleted-loss',
      status: 'loss',
      pnl: -100,
      rMultiple: -2,
      deletedAt: '2026-06-03T10:00:00.000Z',
    },
    {
      ...baseTrade,
      id: 'open-live',
      status: 'open',
      closedAt: null,
    },
    {
      ...baseTrade,
      id: 'review-case',
      tradeKind: 'case',
    },
  ]

  const stats = summarizeStrategyPerformance(trades, 'breakout')

  assert(stats.tradeCount === 1, 'default strategy analytics must include only closed live trades')
  assert(stats.closedCount === 1, 'closed count must use the same live analytics candidates')
  assert(stats.winRate === 100, 'paper, deleted, open, and case records must not affect win rate')
  assert(stats.totalR === 2, 'paper, deleted, open, and case records must not affect total R')
}

export function testEmptyStrategyPerformanceKeepsUnknownMetricsNull(): void {
  const stats = summarizeStrategyPerformance([], 'breakout')

  assert(stats.closedCount === 0, 'empty strategy performance has no closed candidates')
  assert(stats.winRate === null, 'empty win rate must stay unknown instead of becoming zero')
  assert(stats.averageR === null, 'empty average R must stay unknown instead of becoming zero')
}

export function testComputedStrategyStatsReuseTheDefaultLiveAnalyticsScope(): void {
  const stats = computeStrategyStats([
    baseTrade,
    {
      ...baseTrade,
      id: 'paper-loss',
      tradeKind: 'paper',
      status: 'loss',
      pnl: -500,
      rMultiple: -5,
    },
  ], 'breakout')

  assert(stats.tradeCount === 1, 'computed stats must use the same default live candidates')
  assert(stats.winRate === 100, 'computed win rate must not silently merge paper trades')
  assert(stats.totalPnl === 100, 'computed PnL must use the same default live candidates')
}

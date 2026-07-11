import type { Trade } from '@/data/trades'
import {
  DEFAULT_REVIEW_STATUS,
  normalizeReviewFields,
  summarizeStrategyPerformance,
} from '@/lib/reviewAnalytics'

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
  assert(normalized.timeframe === '4H', 'legacy trades without timeframe default to 4H')
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
  assert(stats.tradeCount === 3, 'counts all strategy trades')
  assert(stats.closedCount === 2, 'counts only executed closed trades')
  assert(stats.winRate === 50, 'computes win rate from closed trades')
  assert(stats.totalR === 1, 'sums closed-trade R multiples')
  assert(stats.averageR === 0.5, 'averages closed-trade R multiples')
  assert(stats.worstR === -1, 'finds worst closed-trade R multiple')
  assert(stats.topMistakes[0]?.tag === '追单', 'sorts mistake tags by frequency')
  assert(stats.reviewedCount === 2, 'counts reviewed and focus review states')
}

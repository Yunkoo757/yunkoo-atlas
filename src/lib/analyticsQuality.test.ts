import type { Trade } from '@/data/trades'
import { buildQualityBreakdown } from '@/lib/analyticsQuality'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const trade = (id: string, strategyId: string, mistakeTags: string[], session?: string): Trade => ({
  id, ref: id, symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium', strategyId,
  tags: [], mistakeTags, reviewStatus: 'reviewed', reviewCategory: 'normal', tradeKind: 'live',
  entry: 1, exit: 2, size: 1, pnl: 1, rMultiple: 1, openedAt: '2026-01-01', closedAt: '2026-01-02',
  recordedAt: '2026-01-01', note: '', session,
})

export function testQualityBreakdownKeepsOverlappingTagSamples(): void {
  const result = buildQualityBreakdown([
    trade('1', 'a', ['late'], 'London'),
    trade('2', 'a', ['late', 'fomo'], 'New York'),
    trade('3', 'b', [], 'London'),
  ])
  assert(result.byStrategy[0]?.key === 'a' && result.byStrategy[0]?.count === 2, 'strategy groups are deterministic')
  assert(result.byMistakeTag.find((slice) => slice.key === 'late')?.count === 2, 'multi-tag trades count in every relevant slice')
  assert(result.bySession.find((slice) => slice.key === 'London')?.count === 2, 'session slices preserve source values')
}

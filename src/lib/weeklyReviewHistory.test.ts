import { buildWeeklyReviewHistory } from './weeklyReviewHistory'
import { createWeeklyReview } from '@/data/weeklyReviews'
import type { Trade } from '@/data/trades'

export function testAllStageHistoryKeepsRecordIdentityAndActivityWithoutCreatingReviews() {
  const week = '2026-11-09', previous = '2026-11-02'
  const reviews = [createWeeklyReview(week, 'current'), createWeeklyReview(week, 'old')]
  const trade: Trade = { id: 'old-trade', ref: 'OLD', symbol: 'BTCUSDT', tradeKind: 'live', liveStageId: 'old', side: 'long', status: 'win', conviction: 'medium', strategyId: '', tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal', openedAt: previous, closedAt: previous, pnl: 10, cashCurrency: 'USD', rMultiple: 1, resultSource: 'pnl', entry: 1, exit: 2, size: 1, note: '<p>原图保留</p>' }
  const input = { trades: [trade], reviews, stageIds: ['current', 'old', 'inactive'], selectedStageId: 'current', currentWeek: week, tradingDayStartHour: 0, currentTradingDayKey: '2026-11-15', allStages: true }
  const before = JSON.stringify(input), rows = buildWeeklyReviewHistory(input)
  if (rows.length !== 3 || rows.filter(row => row.week === week).length !== 2) throw Error('All-stage history lost a same-week stage or invented an inactive-stage week')
  const pending = rows.find(row => row.week === previous)!
  if (pending.liveStageId !== 'old' || pending.review || pending.routeId !== createWeeklyReview(previous, 'old').id) throw Error('Pending activity lost its stage identity')
  if (JSON.stringify(input) !== before || rows.find(row => row.liveStageId === 'current')?.review !== reviews[0]) throw Error('History projection mutated records')
  if (JSON.stringify(buildWeeklyReviewHistory(input)) !== JSON.stringify(rows)) throw Error('History identity must be stable')
}

import {
  buildWeeklyReviewTrend,
  createWeeklyReview,
} from '@/data/weeklyReviews'

export function testWeeklyReviewTrendRequiresCompletedWeeksAndRoundsScores(): void {
  const completed = {
    ...createWeeklyReview('2026-07-13'),
    status: 'completed' as const,
    executionScore: 2,
    riskScore: 2,
    emotionScore: 4,
  }
  const draft = {
    ...createWeeklyReview('2026-07-20'),
    executionScore: 5,
    riskScore: 5,
    emotionScore: 5,
  }

  const trend = buildWeeklyReviewTrend([completed, draft])

  if (trend.length !== 1) throw new Error('年度趋势只能包含已完成周')
  if (trend[0]?.score !== 2.7) throw new Error(`趋势评分应保留一位小数，实际为 ${trend[0]?.score}`)
}

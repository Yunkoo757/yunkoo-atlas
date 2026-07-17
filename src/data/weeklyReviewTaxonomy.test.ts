import {
  createWeeklyReview,
  summarizeWeeklyMistakeDimensions,
} from '@/data/weeklyReviews'

export function testWeeklyReviewStatisticsIgnoreCustomTradeLabels(): void {
  const review = {
    ...createWeeklyReview('2026-07-13'),
    mistakeTags: ['追价', 'FOMO', '追单'],
  }

  const counts = summarizeWeeklyMistakeDimensions([review])

  if (counts['追价'] !== 1) throw new Error('固定错误分类必须进入跨周统计')
  if ('FOMO' in counts || '追单' in counts) throw new Error('自定义交易标签不得污染跨周统计维度')
}

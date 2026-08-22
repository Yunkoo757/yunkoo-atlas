import {
  aggregateWeeklyReviewScoresForWeek,
  buildWeeklyReviewTrend,
  createWeeklyReview,
} from '@/data/weeklyReviews'

export function testWeeklyReviewTrendRequiresCompletedWeeksAndRoundsScores(): void {
  const completed = {
    ...createWeeklyReview('2026-07-13', 'stage-current'),
    status: 'completed' as const,
    executionScore: 2,
    riskScore: 2,
    emotionScore: 4,
  }
  const draft = {
    ...createWeeklyReview('2026-07-20', 'stage-current'),
    executionScore: 5,
    riskScore: 5,
    emotionScore: 5,
  }

  const trend = buildWeeklyReviewTrend([completed, draft])

  if (trend.length !== 1) throw new Error('年度趋势只能包含已完成周')
  if (trend[0]?.score !== 2.7) throw new Error(`趋势评分应保留一位小数，实际为 ${trend[0]?.score}`)
}

export function testAllStageTrendAndHeatmapKeepSameWeekStageDimension(): void {
  const stageOne = {
    ...createWeeklyReview('2026-07-13', 'stage-1'),
    status: 'completed' as const,
    executionScore: 2,
    riskScore: 2,
    emotionScore: 2,
  }
  const stageTwo = {
    ...createWeeklyReview('2026-07-13', 'stage-2'),
    status: 'completed' as const,
    executionScore: 4,
    riskScore: 4,
    emotionScore: 4,
  }

  const trend = buildWeeklyReviewTrend([stageOne, stageTwo])
  const heatmap = aggregateWeeklyReviewScoresForWeek([stageOne, stageTwo], '2026-07-13')

  if (trend.length !== 1 || trend[0]?.liveStageId !== null || trend[0].stageCount !== 2 || trend[0].score !== 3) {
    throw new Error('全部阶段趋势必须明确聚合同周所有 stage')
  }
  if (heatmap.completedCount !== 2 || heatmap.averageScore !== 3) {
    throw new Error('全部阶段热力图必须明确聚合同周所有 stage，不能 find 后丢记录')
  }
}

export function testWeeklyReviewTrendCanFilterOneStageWithoutMutatingReviews(): void {
  const stageOne = {
    ...createWeeklyReview('2026-07-13', 'stage-1'),
    status: 'completed' as const,
    executionScore: 2,
    riskScore: 3,
    emotionScore: 4,
  }
  const stageTwo = {
    ...createWeeklyReview('2026-07-20', 'stage-2'),
    status: 'completed' as const,
    executionScore: 5,
    riskScore: 5,
    emotionScore: 5,
  }
  const reviews = [stageOne, stageTwo]
  const before = JSON.stringify(reviews)

  const trend = buildWeeklyReviewTrend(reviews, 'stage-2')

  if (trend.length !== 1 || trend[0]?.week !== '07-20' || trend[0].score !== 5) {
    throw new Error('阶段趋势只能包含所选阶段的已完成周')
  }
  if (JSON.stringify(reviews) !== before) throw new Error('切换趋势阶段不得修改周复盘实体')
}

import { weeklyReviewYear } from '@/lib/weeklyReviewPeriod'
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

export function testWeeklyReviewYearIncludesEveryMondayFromTheSameIsoYear(): void {
  const cases = [
    ['2024-12-30', '2025', '2024-12-30', '2025-12-22', 52],
    ['2020-12-28', '2020', '2019-12-30', '2020-12-28', 53],
    ['0001-01-01', '0001', '0001-01-01', '0001-12-24', 52],
    ['9999-12-27', '9999', '9999-01-04', '9999-12-27', 52],
  ] as const
  for (const [selected, expected, first, last, count] of cases) {
    const { year, weeks } = weeklyReviewYear(selected)
    const keys = [...weeks]
    if (year !== expected || weeks.size !== count || keys[0] !== first ||
      keys.at(-1) !== last || !weeks.has(selected)) {
      throw new Error(`${selected} 未纳入完整 ISO 周年 ${expected}`)
    }
  }
}

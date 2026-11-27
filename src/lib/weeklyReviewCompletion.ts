import type { WeeklyReview } from '@/data/weeklyReviews'

const scores = ['executionScore', 'riskScore', 'emotionScore'] as const
const commitments = ['commitmentText', 'commitmentCriteria'] as const
export type WeeklyRequiredField = typeof scores[number] | typeof commitments[number]
export const WEEKLY_REQUIRED_COUNT = scores.length + commitments.length
export const WEEKLY_UNSAVED_MESSAGE = '正文或图片尚未保存，请重试'

export function evaluateWeeklyReviewCompletion(review: Pick<WeeklyReview, WeeklyRequiredField>, draftSaved = true) {
  const missingScores = scores.filter(key => review[key] === null)
  const missingCommitments = commitments.filter(key => !review[key].trim())
  const missingFields: WeeklyRequiredField[] = [...missingScores, ...missingCommitments]
  let message: string | null = null
  if (!draftSaved) message = WEEKLY_UNSAVED_MESSAGE
  else if (missingScores.length) message = '请先完成执行、风控和情绪三项评分'
  else if (missingCommitments.length) message = '请写清下周只做的一件事和验收标准'
  return { draftSaved, missingFields, completedCount: WEEKLY_REQUIRED_COUNT - missingFields.length, message }
}

export type WeeklyReviewCompletion = ReturnType<typeof evaluateWeeklyReviewCompletion>

export function isStageWeekCompleted(
  reviews: readonly WeeklyReview[],
  liveStageId: string,
  weekStart: string,
): boolean {
  return reviews.some((review) =>
    review.liveStageId === liveStageId &&
    review.weekStart === weekStart &&
    review.status === 'completed',
  )
}

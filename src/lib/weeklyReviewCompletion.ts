import type { WeeklyReview } from '@/data/weeklyReviews'

type WeeklyReviewCompletionFields = Pick<
  WeeklyReview,
  'executionScore' | 'riskScore' | 'emotionScore' | 'commitmentText' | 'commitmentCriteria'
>

export function getWeeklyReviewCompletionIssue(
  review: WeeklyReviewCompletionFields,
  draftSaved: boolean,
): string | null {
  if (!draftSaved) return '正文或图片尚未保存，请重试'
  if ([review.executionScore, review.riskScore, review.emotionScore].some((score) => score === null)) {
    return '请先完成执行、风控和情绪三项评分'
  }
  if (!review.commitmentText.trim() || !review.commitmentCriteria.trim()) {
    return '请写清下周只做的一件事和验收标准'
  }
  return null
}

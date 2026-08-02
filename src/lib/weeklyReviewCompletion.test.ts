import { createWeeklyReview } from '@/data/weeklyReviews'
import { getWeeklyReviewCompletionIssue } from '@/lib/weeklyReviewCompletion'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testWeeklyReviewCompletionBlocksWhenDraftFlushFails(): void {
  const readyReview = {
    ...createWeeklyReview('2026-07-27'),
    executionScore: 4,
    riskScore: 4,
    emotionScore: 4,
    commitmentText: '只做确认后的突破',
    commitmentCriteria: '每笔入场截图都有确认信号',
  }

  assert(
    getWeeklyReviewCompletionIssue(readyReview, false) === '正文或图片尚未保存，请重试',
    '草稿落库失败必须优先阻止周复盘完成与指标冻结',
  )
  assert(getWeeklyReviewCompletionIssue(readyReview, true) === null,
    '草稿与必填项均有效时才允许完成周复盘')
}

export function testWeeklyReviewCompletionKeepsExistingRequiredFieldMessages(): void {
  const review = createWeeklyReview('2026-07-27')
  assert(
    getWeeklyReviewCompletionIssue(review, true) === '请先完成执行、风控和情绪三项评分',
    '评分未完成时应保留明确提示',
  )

  const scored = { ...review, executionScore: 3, riskScore: 3, emotionScore: 3 }
  assert(
    getWeeklyReviewCompletionIssue(scored, true) === '请写清下周只做的一件事和验收标准',
    '行动承诺缺失时应保留明确提示',
  )
}

import assert from 'node:assert/strict'
import { createWeeklyReview } from '@/data/weeklyReviews'
import { getWeeklyVisualIssues } from '@/lib/weeklyReviewVisualState'

export function testWeeklyIssuesReturnStableDocumentOrder(): void {
  const review = createWeeklyReview('2026-08-10', 'stage-current')

  assert.deepEqual(getWeeklyVisualIssues(review).map((issue) => issue.fieldId), [
    'score-execution',
    'score-risk',
    'score-emotion',
    'commitment-text',
    'commitment-criteria',
  ])
}

export function testWeeklyIssuesOnlyContainInvalidFields(): void {
  const review = {
    ...createWeeklyReview('2026-08-10', 'stage-current'),
    executionScore: 4,
    riskScore: 3,
    commitmentText: '等待确认后再入场',
  }

  assert.deepEqual(getWeeklyVisualIssues(review).map((issue) => issue.fieldId), [
    'score-emotion',
    'commitment-criteria',
  ])
}

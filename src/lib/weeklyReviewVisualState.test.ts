import assert from 'node:assert/strict'
import { createWeeklyReview } from '@/data/weeklyReviews'
import { evaluateWeeklyReviewCompletion, WEEKLY_REQUIRED_COUNT } from '@/lib/weeklyReviewCompletion'
import { getWeeklyVisualIssues } from '@/lib/weeklyReviewVisualState'

export function testWeeklyIssuesReturnStableDocumentOrder(): void {
  const review = createWeeklyReview('2026-08-10', 'stage-current')

  assert.deepEqual(getWeeklyVisualIssues(evaluateWeeklyReviewCompletion(review)).map((issue) => issue.fieldId), [
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

  assert.deepEqual(getWeeklyVisualIssues(evaluateWeeklyReviewCompletion(review)).map((issue) => issue.fieldId), [
    'score-emotion',
    'commitment-criteria',
  ])
}

export function testWeeklyProgressAndIssuesAgreeForEveryRequiredFieldCombination(): void {
  const review = createWeeklyReview('2026-08-10', 'stage-current')
  const fields = ['score-execution', 'score-risk', 'score-emotion', 'commitment-text', 'commitment-criteria']
  assert.equal(WEEKLY_REQUIRED_COUNT, fields.length)
  for (let mask = 0; mask < 2 ** fields.length; mask++) {
    const candidate = {
      ...review,
      executionScore: mask & 1 ? 1 : null,
      riskScore: mask & 2 ? 4 : null,
      emotionScore: mask & 4 ? 5 : null,
      commitmentText: mask & 8 ? '步骤' : '  ',
      commitmentCriteria: mask & 16 ? '证据' : '\t',
    }
    const missing = fields.filter((_, index) => !(mask & (1 << index)))
    for (const saved of [true, false]) {
      const completion = evaluateWeeklyReviewCompletion(candidate, saved)
      assert.equal(completion.completedCount, fields.length - missing.length)
      assert.equal(completion.message === null, saved && missing.length === 0)
      assert.deepEqual(getWeeklyVisualIssues(completion).map(issue => issue.fieldId),
        saved ? missing : ['review-content', ...missing])
    }
  }
}

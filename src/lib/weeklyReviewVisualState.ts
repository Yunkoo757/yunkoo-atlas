import type { WeeklyReview } from '@/data/weeklyReviews'

export type WeeklyVisualIssue = Readonly<{
  key: string
  sectionId: string
  fieldId: string
  message: string
}>

type WeeklyVisualFields = Pick<
  WeeklyReview,
  'executionScore' | 'riskScore' | 'emotionScore' | 'commitmentText' | 'commitmentCriteria'
>

const WEEKLY_VISUAL_RULES: ReadonlyArray<{
  issue: WeeklyVisualIssue
  invalid: (review: WeeklyVisualFields) => boolean
}> = [
  {
    issue: { key: 'score-execution', sectionId: 'scores', fieldId: 'score-execution', message: '请为执行纪律评分' },
    invalid: (review) => review.executionScore === null,
  },
  {
    issue: { key: 'score-risk', sectionId: 'scores', fieldId: 'score-risk', message: '请为风险管理评分' },
    invalid: (review) => review.riskScore === null,
  },
  {
    issue: { key: 'score-emotion', sectionId: 'scores', fieldId: 'score-emotion', message: '请为情绪稳定评分' },
    invalid: (review) => review.emotionScore === null,
  },
  {
    issue: { key: 'commitment-text', sectionId: 'commitment', fieldId: 'commitment-text', message: '请写清下周只做的一件事' },
    invalid: (review) => !review.commitmentText.trim(),
  },
  {
    issue: { key: 'commitment-criteria', sectionId: 'commitment', fieldId: 'commitment-criteria', message: '请写清可验证的验收标准' },
    invalid: (review) => !review.commitmentCriteria.trim(),
  },
]

export function getWeeklyVisualIssues(review: WeeklyVisualFields): WeeklyVisualIssue[] {
  return WEEKLY_VISUAL_RULES
    .filter((rule) => rule.invalid(review))
    .map((rule) => rule.issue)
}

export function focusWeeklyIssue(issue: WeeklyVisualIssue, root: ParentNode = document): void {
  const section = root.querySelector<HTMLElement>(`[data-weekly-section="${issue.sectionId}"]`)
  const field = root.querySelector<HTMLElement>(`[data-weekly-field="${issue.fieldId}"]`)
  section?.scrollIntoView({ block: 'center' })
  const focusTarget = field?.matches('button, input, textarea, select, [tabindex]')
    ? field
    : field?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"], button:not(:disabled), [tabindex]:not([tabindex="-1"])')
  focusTarget?.focus()
}

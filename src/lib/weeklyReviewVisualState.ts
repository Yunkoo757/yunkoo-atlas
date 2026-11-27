import { WEEKLY_UNSAVED_MESSAGE, type WeeklyRequiredField, type WeeklyReviewCompletion } from './weeklyReviewCompletion'

export type WeeklyVisualIssue = Readonly<{
  key: string
  sectionId: string
  fieldId: string
  message: string
}>

const fieldIssues: Record<WeeklyRequiredField, WeeklyVisualIssue> = {
  executionScore: { key: 'score-execution', sectionId: 'scores', fieldId: 'score-execution', message: '请为执行纪律评分' },
  riskScore: { key: 'score-risk', sectionId: 'scores', fieldId: 'score-risk', message: '请为风险管理评分' },
  emotionScore: { key: 'score-emotion', sectionId: 'scores', fieldId: 'score-emotion', message: '请为情绪稳定评分' },
  commitmentText: { key: 'commitment-text', sectionId: 'commitment', fieldId: 'commitment-text', message: '请写清下周只做的一件事' },
  commitmentCriteria: { key: 'commitment-criteria', sectionId: 'commitment', fieldId: 'commitment-criteria', message: '请写清可验证的验收标准' },
}

export const unsavedContentIssue: WeeklyVisualIssue = {
  key: 'review-content-unsaved', sectionId: 'judgment', fieldId: 'review-content', message: WEEKLY_UNSAVED_MESSAGE,
}

export function getWeeklyVisualIssues(completion: WeeklyReviewCompletion): WeeklyVisualIssue[] {
  const issues = completion.missingFields.map(key => fieldIssues[key])
  return completion.draftSaved ? issues : [unsavedContentIssue, ...issues]
}

export function focusWeeklyIssue(issue: WeeklyVisualIssue, root: ParentNode = document): void {
  const section = root.querySelector<HTMLElement>(`[data-weekly-section="${issue.sectionId}"]`)
  const field = root.querySelector<HTMLElement>(`[data-weekly-field="${issue.fieldId}"]`)
  const focusTarget = field?.matches('button, input, textarea, select, [tabindex]')
    ? field
    : field?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"], button:not(:disabled), [tabindex]:not([tabindex="-1"])')
  focusTarget?.focus({ preventScroll: true })
  const scrollTarget = focusTarget ?? section
  scrollTarget?.scrollIntoView({ block: 'nearest' })
}

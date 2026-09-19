import type { Judgment, JudgmentAttempt, JudgmentDeskData } from './model'
export const JUDGMENT_LABELS: Record<Judgment, string> = { yes: '是', no: '否', uncertain: '待定' }
export function recordJudgment(data: JudgmentDeskData, sampleId: string, value: Judgment, attemptId: string, at: string): JudgmentDeskData {
  const sample = data.samples.find(s => s.id === sampleId)
  if (!sample || data.attempts.some(a => a.id === attemptId)) return data
  return { ...data, samples: data.samples.map(s => s.id === sampleId ? { ...s, opinion: value } : s), attempts: [...data.attempts, {
    id: attemptId, sampleId, at, answer: value, previous: sample.opinion,
    reference: sample.reference ? { ...sample.reference } : null,
    understanding: data.themes.find(t => t.id === sample.themeId)?.understanding ?? '',
  }] }
}
/** Only the immediately last assessment may be undone, and only before another opinion edit. */
export function undoJudgment(data: JudgmentDeskData, attemptId: string): JudgmentDeskData {
  const last = data.attempts.at(-1)
  if (!last || last.id !== attemptId || data.samples.find(s => s.id === last.sampleId)?.opinion !== last.answer) return data
  return { ...data, attempts: data.attempts.slice(0, -1), samples: data.samples.map(s => s.id === last.sampleId ? { ...s, opinion: last.previous } : s) }
}
export function attemptComparison(a: JudgmentAttempt): string {
  if (a.reference && !a.reference.needsReview) return a.answer === a.reference.answer ? '与当时参考判断一致' : '与当时参考判断不同'
  return a.previous === null ? '首次留下判断' : a.answer === a.previous ? '与上次判断一致' : '与上次判断不同'
}

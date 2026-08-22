import type { LiveStage } from '@/lib/liveStages'

function parseCanonicalDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value ? date : null
}

export function isCanonicalWeeklyReviewPeriod(weekStart: string, weekEnd: string): boolean {
  const start = parseCanonicalDay(weekStart)
  const end = parseCanonicalDay(weekEnd)
  if (!start || !end || start.getUTCDay() !== 1) return false
  start.setUTCDate(start.getUTCDate() + 6)
  return start.getTime() === end.getTime()
}

export function stageContainsWeeklyReviewPeriod(
  stage: LiveStage,
  weekStart: string,
  weekEnd: string,
): boolean {
  return isCanonicalWeeklyReviewPeriod(weekStart, weekEnd) &&
    weekStart >= stage.startsOn &&
    (stage.endsOn === null || weekEnd <= stage.endsOn)
}

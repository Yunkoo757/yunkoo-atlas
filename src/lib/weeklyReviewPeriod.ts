import { parseCalendarDay } from '@/lib/calendarDay'
import type { LiveStage } from '@/lib/liveStages'

export function isCanonicalWeeklyReviewPeriod(weekStart: string, weekEnd: string): boolean {
  const start = parseCalendarDay(weekStart)
  const end = parseCalendarDay(weekEnd)
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

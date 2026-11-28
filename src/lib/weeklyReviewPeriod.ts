import { calendarWeekStart, isCalendarDay, parseCalendarDay, shiftCalendarDay } from '@/lib/calendarDay'
import type { LiveStage } from '@/lib/liveStages'

export function isWeeklyReviewStart(value: string): boolean {
  return parseCalendarDay(value)?.getUTCDay() === 1
}

export function isCanonicalWeeklyReviewPeriod(weekStart: string, weekEnd: string): boolean {
  return isWeeklyReviewStart(weekStart) && isCalendarDay(weekEnd) && shiftCalendarDay(weekStart, 6) === weekEnd
}

/** 输入为复盘周一。ISO 周年由同周周四决定，1 月 4 日与 12 月 28 日分别落在首周和末周。 */
export function weeklyReviewYear(weekStart: string) {
  const year = shiftCalendarDay(weekStart, 3).slice(0, 4)
  const firstWeek = calendarWeekStart(year + '-01-04')
  const lastWeek = calendarWeekStart(year + '-12-28')
  const weeks = new Set<string>([firstWeek])
  let week = firstWeek
  while (week < lastWeek) {
    week = shiftCalendarDay(week, 7)
    weeks.add(week)
  }
  return { year, weeks }
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

/** 资料库中的 YYYY-MM-DD 是公历日期。UTC 午夜只用作日历计算的坐标。 */
export function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && formatCalendarDay(date) === value ? date : null
}

export function isCalendarDay(value: unknown): value is string {
  return parseCalendarDay(value) !== null
}

export function formatCalendarDay(utcDate: Date): string {
  return utcDate.toISOString().split('T')[0]!
}

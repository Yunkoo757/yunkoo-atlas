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
  const iso = utcDate.toISOString()
  return iso.slice(0, iso.indexOf('T'))
}

function requireDay(value: string): Date {
  const date = parseCalendarDay(value)
  if (!date) throw new RangeError('公历日期必须是有效的 YYYY-MM-DD')
  return date
}

export function shiftCalendarDay(value: string, days: number): string {
  const date = requireDay(value)
  date.setUTCDate(date.getUTCDate() + days)
  return formatCalendarDay(date)
}

export function calendarWeekStart(value: string, weekStartsOn = 1): string {
  const date = requireDay(value)
  const distance = (date.getUTCDay() - weekStartsOn + 7) % 7
  date.setUTCDate(date.getUTCDate() - distance)
  return formatCalendarDay(date)
}

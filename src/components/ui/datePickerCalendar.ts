/** 本地日历日期；setFullYear 避免 Date 构造器把 0001–0099 映射为 1901–1999。 */
export function calendarDate(year: number, month: number, day = 1): Date {
  const date = new Date(2000, 0, 1)
  date.setFullYear(year, month, day)
  return date
}

export function toYmd(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseYmd(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match || Number(match[1]) < 1) return null
  const date = calendarDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return toYmd(date) === value ? date : null
}

export function addDays(date: Date, amount: number): Date {
  return calendarDate(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

export function addMonthsClamped(date: Date, amount: number): Date {
  const target = calendarDate(date.getFullYear(), date.getMonth() + amount)
  const lastDay = calendarDate(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return calendarDate(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay))
}

export function yearPageStart(year: number): number {
  return Math.min(9988, Math.max(1, year - ((year - 1) % 12)))
}

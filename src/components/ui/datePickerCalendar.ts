import { parseCalendarDay } from '@/lib/calendarDay'

/** 月份和日期可溢出，用于构建相邻月的网格；保留 0001–0099 的原年份。 */
export function calendarDate(year: number, month: number, day = 1): Date {
  const date = new Date(0)
  date.setUTCFullYear(year, month, day)
  return date
}

/** “今天”按设备的本地日历取值，之后的网格和导航都使用同一公历坐标。 */
export function todayInCalendar(): Date {
  const now = new Date()
  return calendarDate(now.getFullYear(), now.getMonth(), now.getDate())
}

export function parsePickerDay(value: string): Date | null {
  const date = parseCalendarDay(value)
  return date && date.getUTCFullYear() >= 1 ? date : null
}

export function addDays(date: Date, amount: number): Date {
  return calendarDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + amount)
}

export function addMonthsClamped(date: Date, amount: number): Date {
  const target = calendarDate(date.getUTCFullYear(), date.getUTCMonth() + amount)
  const lastDay = calendarDate(target.getUTCFullYear(), target.getUTCMonth() + 1, 0).getUTCDate()
  return calendarDate(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay))
}

export function yearPageStart(year: number): number {
  return Math.min(9988, Math.max(1, year - ((year - 1) % 12)))
}

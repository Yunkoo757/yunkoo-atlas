import type { Trade } from '@/data/trades'

export type CalendarPeriod =
  | 'today'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'

export const CALENDAR_PERIODS: CalendarPeriod[] = [
  'today',
  'this-week',
  'last-week',
  'this-month',
  'last-month',
]

export const PERIOD_LABELS: Record<CalendarPeriod, string> = {
  today: '今日',
  'this-week': '本周',
  'last-week': '上周',
  'this-month': '本月',
  'last-month': '上月',
}

export const WEEK_STARTS_ON = 1 // 周一

export interface DateBounds {
  start: string // YYYY-MM-DD inclusive
  end: string // YYYY-MM-DD inclusive
}

/** 解析 YYYY-MM-DD 为本地日历日（避免 UTC 偏移） */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function startOfWeek(d: Date, weekStartsOn = WEEK_STARTS_ON): Date {
  const day = d.getDay()
  const diff = (day - weekStartsOn + 7) % 7
  return startOfDay(addDays(d, -diff))
}

function endOfWeek(d: Date, weekStartsOn = WEEK_STARTS_ON): Date {
  const start = startOfWeek(d, weekStartsOn)
  return addDays(start, 6)
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

export function getPeriodBounds(
  period: CalendarPeriod,
  now = new Date(),
  weekStartsOn = WEEK_STARTS_ON,
): DateBounds {
  const today = startOfDay(now)

  switch (period) {
    case 'today':
      return { start: formatYmd(today), end: formatYmd(today) }
    case 'this-week': {
      const s = startOfWeek(today, weekStartsOn)
      const e = endOfWeek(today, weekStartsOn)
      return { start: formatYmd(s), end: formatYmd(e) }
    }
    case 'last-week': {
      const thisStart = startOfWeek(today, weekStartsOn)
      const s = addDays(thisStart, -7)
      const e = addDays(thisStart, -1)
      return { start: formatYmd(s), end: formatYmd(e) }
    }
    case 'this-month': {
      const s = startOfMonth(today)
      const e = endOfMonth(today)
      return { start: formatYmd(s), end: formatYmd(e) }
    }
    case 'last-month': {
      const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      return {
        start: formatYmd(startOfMonth(prev)),
        end: formatYmd(endOfMonth(prev)),
      }
    }
  }
}

export function isDateInRange(
  iso: string,
  bounds: DateBounds,
): boolean {
  const d = iso.slice(0, 10)
  return d >= bounds.start && d <= bounds.end
}

export function tradeInPeriod(
  trade: Trade,
  period: CalendarPeriod,
  field: 'openedAt' | 'closedAt' = 'openedAt',
  now = new Date(),
): boolean {
  const bounds = getPeriodBounds(period, now)
  const raw =
    field === 'closedAt'
      ? trade.closedAt ?? trade.openedAt
      : trade.openedAt
  return isDateInRange(raw, bounds)
}

export function formatPeriodSubtitle(period: CalendarPeriod, now = new Date()): string {
  const bounds = getPeriodBounds(period, now)
  const label = PERIOD_LABELS[period]
  if (period === 'today') {
    return `${label} · ${bounds.start} · 按开仓日`
  }
  return `${label} · ${bounds.start} – ${bounds.end} · 按开仓日`
}

export function isValidPeriodSlug(slug: string): slug is CalendarPeriod {
  return (CALENDAR_PERIODS as string[]).includes(slug)
}

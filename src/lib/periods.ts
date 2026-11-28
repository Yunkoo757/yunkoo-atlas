import { calendarWeekStart, formatCalendarDay, isCalendarDay, parseCalendarDay, shiftCalendarDay } from '@/lib/calendarDay'
import type { Trade } from '@/data/trades'

export type CalendarPeriod =
  | 'today'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'ytd'

export const CALENDAR_PERIODS: CalendarPeriod[] = [
  'today',
  'this-week',
  'last-week',
  'this-month',
  'last-month',
  'ytd',
]

export const PERIOD_LABELS: Record<CalendarPeriod, string> = {
  today: '今日',
  'this-week': '本周',
  'last-week': '上周',
  'this-month': '本月',
  'last-month': '上月',
  ytd: '本年',
}

export const WEEK_STARTS_ON = 1 // 周一

/** 交易日从本地几点开始（0=日历午夜；默认 6 点，凌晨单仍算前一日）。 */
export const DEFAULT_TRADING_DAY_START_HOUR = 6

export const TRADING_DAY_START_HOUR_OPTIONS: ReadonlyArray<{
  value: number
  label: string
  description: string
}> = [
  { value: 0, label: '0:00（日历日）', description: '午夜准时换日' },
  { value: 4, label: '4:00', description: '偏早换日' },
  { value: 5, label: '5:00', description: '清晨换日' },
  { value: 6, label: '6:00（推荐）', description: '覆盖大半凌晨收尾' },
  { value: 7, label: '7:00', description: '上午换日' },
  { value: 8, label: '8:00', description: '开盘前换日' },
  { value: 9, label: '9:00', description: '偏晚换日' },
]

export function normalizeTradingDayStartHour(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23) {
    return value
  }
  return DEFAULT_TRADING_DAY_START_HOUR
}

/**
 * 当前「交易日」YYYY-MM-DD。
 * 本地时刻若尚未到达 startHour，仍归属前一个日历日。
 */
export function getTradingDayKey(
  now = new Date(),
  startHour = DEFAULT_TRADING_DAY_START_HOUR,
): string {
  const hour = normalizeTradingDayStartHour(startHour)
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  if (now.getHours() < hour) {
    cursor.setDate(cursor.getDate() - 1)
  }
  return formatYmd(cursor)
}

/** 距离下一次交易日切换的毫秒数（用于页面自动换日）。 */
export function msUntilNextTradingDayBoundary(
  now = new Date(),
  startHour = DEFAULT_TRADING_DAY_START_HOUR,
): number {
  const hour = normalizeTradingDayStartHour(startHour)
  const next = new Date(now)
  next.setHours(hour, 0, 0, 25)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return Math.max(1_000, next.getTime() - now.getTime())
}

export interface DateBounds {
  start: string // YYYY-MM-DD inclusive
  end: string // YYYY-MM-DD inclusive
}

export interface BusinessDateAnchor {
  now: Date
  tradingDayStartHour: number
  currentTradingDayKey: string
}

export function createBusinessDateAnchor(
  now = new Date(),
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
): BusinessDateAnchor {
  const normalizedHour = normalizeTradingDayStartHour(tradingDayStartHour)
  const stableNow = new Date(now)
  return {
    now: stableNow,
    tradingDayStartHour: normalizedHour,
    currentTradingDayKey: getTradingDayKey(stableNow, normalizedHour),
  }
}

function resolveBusinessDateAnchor(
  value: Date | BusinessDateAnchor,
  tradingDayStartHour: number,
): BusinessDateAnchor {
  return value instanceof Date
    ? createBusinessDateAnchor(value, tradingDayStartHour)
    : value
}

/** 解析 YYYY-MM-DD 为本地日历日（避免 UTC 偏移） */
export function parseLocalDate(iso: string): Date {
  if (!iso || iso.length < 10) return new Date()
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (isNaN(y) || isNaN(m) || isNaN(d)) return new Date()
  const local = new Date(2000, 0, 1)
  local.setFullYear(y, m - 1, d)
  return local
}

export function formatYmd(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 记录的显示日。纯日期保留原值，带时间的记录沿用设备本地日期。 */
export function recordDisplayDay(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isCalendarDay(value) ? value : null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? formatYmd(date) : null
}

/** 从配置后的当前业务交易日起偏移日历天，用于生成规范 YYYY-MM-DD 排期。 */
export function addDaysToCurrentTradingDay(
  now: Date,
  tradingDayStartHour: number,
  days: number,
): string {
  const currentTradingDayKey = getTradingDayKey(now, tradingDayStartHour)
  return shiftCalendarDay(currentTradingDayKey, days)
}

export function getPeriodBounds(
  period: CalendarPeriod,
  now: Date | BusinessDateAnchor = new Date(),
  weekStartsOn = WEEK_STARTS_ON,
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
): DateBounds {
  const anchor = resolveBusinessDateAnchor(now, tradingDayStartHour)
  const today = anchor.currentTradingDayKey
  switch (period) {
    case 'today':
      return { start: today, end: today }
    case 'this-week':
    case 'last-week': {
      const thisWeek = calendarWeekStart(today, weekStartsOn)
      const start = period === 'this-week' ? thisWeek : shiftCalendarDay(thisWeek, -7)
      return { start, end: shiftCalendarDay(start, 6) }
    }
    case 'this-month':
    case 'last-month': {
      const lastDay = parseCalendarDay(today)!
      lastDay.setUTCMonth(lastDay.getUTCMonth() + (period === 'this-month' ? 1 : 0), 0)
      const end = formatCalendarDay(lastDay)
      return { start: end.slice(0, -2) + '01', end }
    }
    case 'ytd':
      return { start: today.slice(0, 4) + '-01-01', end: today }
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
  now: Date | BusinessDateAnchor = new Date(),
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
): boolean {
  const bounds = getPeriodBounds(period, now, WEEK_STARTS_ON, tradingDayStartHour)
  const raw =
    field === 'closedAt'
      ? trade.closedAt ?? trade.openedAt
      : trade.openedAt
  return isDateInRange(raw, bounds)
}

export function isValidPeriodSlug(slug: string): slug is CalendarPeriod {
  return (CALENDAR_PERIODS as string[]).includes(slug)
}

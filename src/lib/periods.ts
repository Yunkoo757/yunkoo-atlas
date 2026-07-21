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
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
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
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 25)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return Math.max(1_000, next.getTime() - now.getTime())
}

export interface DateBounds {
  start: string // YYYY-MM-DD inclusive
  end: string // YYYY-MM-DD inclusive
}

/** 解析 YYYY-MM-DD 为本地日历日（避免 UTC 偏移） */
export function parseLocalDate(iso: string): Date {
  if (!iso || iso.length < 10) return new Date()
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (isNaN(y) || isNaN(m) || isNaN(d)) return new Date()
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
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
): DateBounds {
  const today = startOfDay(now)

  switch (period) {
    case 'today': {
      const key = getTradingDayKey(now, tradingDayStartHour)
      return { start: key, end: key }
    }
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
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
): boolean {
  const bounds = getPeriodBounds(period, now, WEEK_STARTS_ON, tradingDayStartHour)
  const raw =
    field === 'closedAt'
      ? trade.closedAt ?? trade.openedAt
      : trade.openedAt
  return isDateInRange(raw, bounds)
}

export function formatPeriodSubtitle(
  period: CalendarPeriod,
  now = new Date(),
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
): string {
  const bounds = getPeriodBounds(period, now, WEEK_STARTS_ON, tradingDayStartHour)
  // 今日筛选页标题已包含「今日」，副标题不再重复范围名称
  if (period === 'today') {
    return `${bounds.start} · 按开仓日 · 交易日`
  }
  return `${PERIOD_LABELS[period]} · ${bounds.start} – ${bounds.end} · 按开仓日`
}

export function isValidPeriodSlug(slug: string): slug is CalendarPeriod {
  return (CALENDAR_PERIODS as string[]).includes(slug)
}

// ---- 智能日期分桶 (列表分组用) ----

export type DateBucket =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'earlier-this-month'
  | 'last-month'
  | { year: number; month: number } // YYYY年M月

export const DATE_BUCKET_ORDER: DateBucket[] = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'earlier-this-month',
  'last-month',
]

export function formatDateBucket(bucket: DateBucket): string {
  if (typeof bucket === 'object') {
    return `${bucket.year}年${bucket.month}月`
  }
  switch (bucket) {
    case 'today':
      return '今日'
    case 'yesterday':
      return '昨日'
    case 'this-week':
      return '本周'
    case 'last-week':
      return '上周'
    case 'earlier-this-month':
      return '本月更早'
    case 'last-month':
      return '上月'
  }
}

/** 日期桶排序 key：越近越大 */
export function dateBucketSortKey(bucket: DateBucket, ts: number): number {
  if (typeof bucket === 'object') {
    return bucket.year * 100 + bucket.month
  }
  // 用参考时间戳保证同一天的桶顺序一致
  return ts
}

/**
 * 将 ISO 日期字符串映射到智能分桶。
 * 传入参考点 refDate (通常是当前日期) 来计算相对桶。
 */
export function classifyDateBucket(
  iso: string,
  refDate: Date = new Date(),
  weekStartsOn = WEEK_STARTS_ON,
): DateBucket {
  const d = parseLocalDate(iso)
  const today = startOfDay(refDate)
  const ymd = formatYmd(d)
  const todayYmd = formatYmd(today)

  // 今日
  if (ymd === todayYmd) return 'today'

  // 昨日
  const yesterday = addDays(today, -1)
  if (ymd === formatYmd(yesterday)) return 'yesterday'

  // 本周（排除今日和昨日）
  const thisWeekStart = startOfWeek(today, weekStartsOn)
  if (d >= thisWeekStart) return 'this-week'

  // 上周
  const lastWeekStart = addDays(thisWeekStart, -7)
  const lastWeekEnd = addDays(thisWeekStart, -1)
  if (d >= lastWeekStart && d <= lastWeekEnd) return 'last-week'

  // 本月更早（排除本周和上周所在月份内更早的日期）
  const thisMonthStart = startOfMonth(today)
  if (d >= thisMonthStart) return 'earlier-this-month'

  // 上月
  const lastMonthStart = startOfMonth(new Date(today.getFullYear(), today.getMonth() - 1, 1))
  const lastMonthEnd = endOfMonth(lastMonthStart)
  if (d >= lastMonthStart && d <= lastMonthEnd) return 'last-month'

  // 更早 → 按 YYYY年M月
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

/** 两个 DateBucket 比较，用于排序：越近越靠前 */
export function compareDateBucket(a: DateBucket, b: DateBucket, aTs: number, bTs: number): number {
  const order: string[] = [
    'today',
    'yesterday',
    'this-week',
    'last-week',
    'earlier-this-month',
    'last-month',
  ]

  const aKey =
    typeof a === 'object' ? `${a.year}-${String(a.month).padStart(2, '0')}` : order.indexOf(a)
  const bKey =
    typeof b === 'object' ? `${b.year}-${String(b.month).padStart(2, '0')}` : order.indexOf(b)

  if (typeof a === 'object' && typeof b === 'object') {
    return bTs - aTs // 按月降序
  }
  if (typeof a === 'object') return 1 // object buckets go after named buckets
  if (typeof b === 'object') return -1

  return order.indexOf(a) - order.indexOf(b) // named buckets: later index = older = sort after
}

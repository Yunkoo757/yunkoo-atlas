import {
  DEFAULT_TRADING_DAY_START_HOUR,
  createBusinessDateAnchor,
  getPeriodBounds,
  getTradingDayKey,
  msUntilNextTradingDayBoundary,
  normalizeTradingDayStartHour,
} from '@/lib/periods'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testTradingDayKeyRollsBeforeStartHour(): void {
  // 2026-07-22 03:30 → 交易日仍为 21 日（默认 6:00 切日）
  const early = new Date(2026, 6, 22, 3, 30, 0)
  assert(
    getTradingDayKey(early, 6) === '2026-07-21',
    '凌晨未到切日时刻应归属前一交易日',
  )
  const after = new Date(2026, 6, 22, 6, 0, 0)
  assert(
    getTradingDayKey(after, 6) === '2026-07-22',
    '到达切日时刻应进入新交易日',
  )
  assert(
    getTradingDayKey(early, 0) === '2026-07-22',
    '切日为 0:00 时与日历日一致',
  )
}

export function testTodayPeriodBoundsFollowTradingDay(): void {
  const early = new Date(2026, 6, 22, 2, 0, 0)
  const bounds = getPeriodBounds('today', early, 1, 6)
  assert(bounds.start === '2026-07-21' && bounds.end === '2026-07-21', '今日周期应按交易日')
}

export function testAllCalendarPeriodBoundsUseTheSameBusinessDateAnchor(): void {
  const beforeBoundary = createBusinessDateAnchor(new Date(2026, 7, 3, 3, 59, 59, 999), 4)
  assert(beforeBoundary.currentTradingDayKey === '2026-08-02', '边界前 1ms 必须仍锚定前一交易日')
  assert(getPeriodBounds('this-week', beforeBoundary).start === '2026-07-27', '本周必须按锚点日期计算')
  assert(getPeriodBounds('this-month', beforeBoundary).start === '2026-08-01', '本月必须按锚点日期计算')

  const atBoundary = createBusinessDateAnchor(new Date(2026, 7, 3, 4, 0, 0, 0), 4)
  assert(atBoundary.currentTradingDayKey === '2026-08-03', '边界时刻必须进入新交易日')
  assert(getPeriodBounds('this-week', atBoundary).start === '2026-08-03', '跨周时本周必须同步切换')
}

export function testBusinessDateAnchorHandlesMonthAndYearBoundaries(): void {
  const newYearBeforeBoundary = createBusinessDateAnchor(new Date(2027, 0, 1, 3, 59, 59, 999), 4)
  assert(newYearBeforeBoundary.currentTradingDayKey === '2026-12-31', '元旦换日前仍属于上一交易年')
  assert(getPeriodBounds('this-month', newYearBeforeBoundary).start === '2026-12-01', '本月必须保持上一交易月')
  const newYearAtBoundary = createBusinessDateAnchor(new Date(2027, 0, 1, 4, 0, 0, 0), 4)
  assert(getPeriodBounds('this-month', newYearAtBoundary).start === '2027-01-01', '换日后本月必须进入一月')
}

export function testNormalizeTradingDayStartHour(): void {
  assert(normalizeTradingDayStartHour(undefined) === DEFAULT_TRADING_DAY_START_HOUR, '缺省回落默认')
  assert(normalizeTradingDayStartHour(8) === 8, '合法整数保留')
  assert(normalizeTradingDayStartHour(24) === DEFAULT_TRADING_DAY_START_HOUR, '非法值回落默认')
  assert(normalizeTradingDayStartHour(3.5) === DEFAULT_TRADING_DAY_START_HOUR, '非整数回落默认')
}

export function testMsUntilNextTradingDayBoundary(): void {
  const before = new Date(2026, 6, 22, 5, 0, 0)
  const wait = msUntilNextTradingDayBoundary(before, 6)
  const expected = new Date(2026, 6, 22, 6, 0, 0, 25).getTime() - before.getTime()
  assert(Math.abs(wait - expected) < 5, '应排程到当日切日时刻')

  const after = new Date(2026, 6, 22, 7, 0, 0)
  const waitNext = msUntilNextTradingDayBoundary(after, 6)
  const expectedNext = new Date(2026, 6, 23, 6, 0, 0, 25).getTime() - after.getTime()
  assert(Math.abs(waitNext - expectedNext) < 5, '过切日后应排程到次日')
}
// Quality-Scenario: B-CALENDAR

import {
  addDaysToCurrentTradingDay,
  DEFAULT_TRADING_DAY_START_HOUR,
  createBusinessDateAnchor,
  getPeriodBounds,
  getTradingDayKey,
  msUntilNextTradingDayBoundary,
  normalizeTradingDayStartHour,
  parseLocalDate,
  formatYmd,
} from '@/lib/periods'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testReviewScheduleOffsetsUseTheConfiguredTradingDayBoundary(): void {
  const beforeBoundary = new Date(2026, 7, 12, 5, 30, 0)
  const afterBoundary = new Date(2026, 7, 12, 6, 30, 0)

  assert(addDaysToCurrentTradingDay(beforeBoundary, 6, 3) === '2026-08-14', '起始小时前的 +3 必须从前一业务日计算')
  assert(addDaysToCurrentTradingDay(beforeBoundary, 6, 7) === '2026-08-18', '起始小时前的 +7 必须从前一业务日计算')
  assert(addDaysToCurrentTradingDay(afterBoundary, 6, 3) === '2026-08-15', '起始小时后的 +3 必须从当前业务日计算')
  assert(addDaysToCurrentTradingDay(afterBoundary, 6, 7) === '2026-08-19', '起始小时后的 +7 必须从当前业务日计算')
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

export function testYtdPeriodBoundsStartAtTheBusinessYearAndNeverIncludeFutureDays(): void {
  const beforeBoundary = createBusinessDateAnchor(new Date(2026, 6, 22, 3, 30), 6)
  const bounds = getPeriodBounds('ytd', beforeBoundary)
  assert(
    bounds.start === '2026-01-01' && bounds.end === '2026-07-21',
    '本年范围必须从当前交易年的首日截至当前交易日，不能纳入未来日期',
  )

  const newYearBeforeBoundary = createBusinessDateAnchor(new Date(2027, 0, 1, 3, 30), 6)
  const priorYearBounds = getPeriodBounds('ytd', newYearBeforeBoundary)
  assert(
    priorYearBounds.start === '2026-01-01' && priorYearBounds.end === '2026-12-31',
    '元旦切日前的本年必须仍以归属交易年为准',
  )
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

export function testPersistedRangeBoundariesSurviveSkippedDeviceDays(): void {
  const zone = process.env.TZ
  try {
    process.env.TZ = 'Pacific/Kiritimati'
    const january = new Date(1995, 0, 12, 12)
    const previous = getPeriodBounds('last-month', january)
    assert(previous.start === '1994-12-01' && previous.end === '1994-12-31',
      `上月应止于已保存的 12 月 31 日，实际为 ${previous.end}`)

    process.env.TZ = 'Pacific/Apia'
    const thursday = new Date(2011, 11, 29, 12)
    assert(addDaysToCurrentTradingDay(thursday, 6, 1) === '2011-12-30', '排期 +1 应保留相邻公历日')
    const week = getPeriodBounds('this-week', thursday, 6)
    assert(week.start === '2011-12-24' && week.end === '2011-12-30', '自选周六起始也应保留完整七个日期')
  } finally {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  }
}

export function testBusinessDatePreservesFourDigitHistoricalYears(): void {
  const day = '0099-01-05'
  const local = parseLocalDate(day)
  local.setHours(12)
  assert(formatYmd(local) === day && getTradingDayKey(local) === day, '四位历史年份不得变成 1999')
  assert(getPeriodBounds('this-week', local).start === day, '历史交易日应保持所属周一')
  assert(getPeriodBounds('last-month', local).end === '0098-12-31', '历史年边界也使用四位年份')
}

// Quality-Scenario: B-CALENDAR

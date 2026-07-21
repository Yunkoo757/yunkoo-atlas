import {
  DEFAULT_TRADING_DAY_START_HOUR,
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

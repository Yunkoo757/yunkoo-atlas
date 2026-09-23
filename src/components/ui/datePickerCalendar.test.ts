import { addDays, addMonthsClamped, calendarDate, parseYmd, toYmd, yearPageStart } from './datePickerCalendar'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testHistoricalDatesPreserveExactYearsAndRejectImpossibleDates() {
  for (const value of ['0001-01-01', '0099-12-31', '1900-02-28', '1980-02-29', '2000-02-29', '9999-12-31']) {
    assert(toYmd(parseYmd(value)!) === value, `日期未正确往返 ${value}`)
  }
  for (const value of ['0000-01-01', '1900-02-29', '2026-02-29', '2026-13-01', '2026-01-00', '2026-01-01bad']) {
    assert(parseYmd(value) === null, `应拒绝无效日期 ${value}`)
  }
}

export function testYearAndMonthNavigationClampLeapDaysWithoutLosingHistoricalYear() {
  assert(toYmd(addMonthsClamped(calendarDate(2000, 1, 29), -12)) === '1999-02-28', '闰日跨年应落在月底')
  assert(toYmd(addMonthsClamped(calendarDate(2026, 0, 31), 1)) === '2026-02-28', '月末切换不应溢出')
  assert(toYmd(addDays(calendarDate(100, 0, 1), -1)) === '0099-12-31', '跨世纪日期应保留年份')
  assert(yearPageStart(1) === 1 && yearPageStart(9999) + 11 === 9999, '年份分页应在支持范围内')
}

import { getGreeting } from './greeting'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function localDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0)
}

export function testGreetingFollowsLocalTimePeriods(): void {
  const cases: Array<[number, string]> = [
    [2, '凌晨好'],
    [7, '早上好'],
    [10, '上午好'],
    [12, '中午好'],
    [16, '下午好'],
    [20, '晚上好'],
    [23, '夜深了'],
  ]

  for (const [hour, expected] of cases) {
    assert(
      getGreeting(localDate(2026, 7, 18, hour)) === expected,
      `${hour} 时应显示“${expected}”`,
    )
  }
}

export function testFestivalGreetingOverridesTimePeriod(): void {
  assert(getGreeting(localDate(2026, 1, 1, 2)) === '新年好', '元旦问候应覆盖凌晨问候')
  assert(getGreeting(localDate(2026, 10, 1, 9)) === '国庆节快乐', '国庆节应显示专属问候')
  assert(getGreeting(localDate(2026, 12, 25, 20)) === '圣诞快乐', '圣诞节应显示专属问候')
  assert(getGreeting(localDate(2026, 2, 17, 8)) === '春节快乐', '春节应按农历日期识别')
  assert(getGreeting(localDate(2026, 6, 19, 8)) === '端午安康', '端午节应按农历日期识别')
  assert(getGreeting(localDate(2026, 9, 25, 8)) === '中秋节快乐', '中秋节应按农历日期识别')
}


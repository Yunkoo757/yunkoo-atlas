const SOLAR_GREETINGS: Readonly<Record<string, string>> = {
  '01-01': '新年好',
  '02-14': '情人节快乐',
  '05-01': '劳动节快乐',
  '10-01': '国庆节快乐',
  '12-24': '平安夜快乐',
  '12-25': '圣诞快乐',
}

const LUNAR_GREETINGS: Readonly<Record<string, string>> = {
  '1-1': '春节快乐',
  '1-15': '元宵节快乐',
  '5-5': '端午安康',
  '7-7': '七夕快乐',
  '8-15': '中秋节快乐',
  '9-9': '重阳安康',
  '12-8': '腊八安康',
}

const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  month: 'numeric',
  day: 'numeric',
})

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function lunarDateKey(date: Date): string | null {
  const parts = lunarFormatter.formatToParts(date)
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!month || !day || !/^\d+$/.test(month) || !/^\d+$/.test(day)) return null
  return `${Number(month)}-${Number(day)}`
}

function festivalGreeting(date: Date): string | null {
  const solarKey = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const solarGreeting = SOLAR_GREETINGS[solarKey]
  if (solarGreeting) return solarGreeting

  const lunarKey = lunarDateKey(date)
  const lunarGreeting = lunarKey ? LUNAR_GREETINGS[lunarKey] : undefined
  if (lunarGreeting) return lunarGreeting

  const tomorrow = new Date(date)
  tomorrow.setDate(date.getDate() + 1)
  if (lunarDateKey(tomorrow) === '1-1') return '除夕安康'

  return null
}

function timeGreeting(hour: number): string {
  if (hour < 5) return '凌晨好'
  if (hour < 9) return '早上好'
  if (hour < 12) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  if (hour < 23) return '晚上好'
  return '夜深了'
}

/** 特殊节日优先，其余时间按本机小时返回问候。 */
export function getGreeting(date = new Date()): string {
  return festivalGreeting(date) ?? timeGreeting(date.getHours())
}


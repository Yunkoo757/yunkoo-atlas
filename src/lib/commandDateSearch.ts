import type { Trade } from '@/data/trades'
import { matchesSearchQuery } from './tradeFilters'

export type CommandDateQuery =
  | { kind: 'text'; text: string }
  | { kind: 'incomplete' | 'invalid'; message: string }
  | { kind: 'date'; text: string; start: string; end: string; label: string }

function monthDays(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** 只把独立的日期词解释为范围；TRD-202405 等编号仍走普通文本搜索。 */
export function parseCommandDateQuery(query: string): CommandDateQuery {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  const index = tokens.findIndex((token) => /^\d{4}(?:\d{0,4}|-\d{0,2}(?:-\d{0,2})?)$/.test(token))
  if (index < 0) return { kind: 'text', text: query.trim() }
  const token = tokens[index]!
  const compact = token.replace(/-/g, '')
  const year = Number(compact.slice(0, 4))
  const month = compact.length > 4 ? Number(compact.slice(4, 6)) : 0
  const day = compact.length > 6 ? Number(compact.slice(6, 8)) : 0
  const invalid = (): CommandDateQuery => ({ kind: 'invalid', message: '日期无效，请检查年、月、日' })
  if (year < 1) return invalid()
  if (!/^\d{4}(?:\d{2}(?:\d{2})?|(?:-\d{2})(?:-\d{2})?)?$/.test(token)) {
    if (compact.length >= 6 && (month < 1 || month > 12)) return invalid()
    return { kind: 'incomplete', message: compact.length <= 5 ? '请继续输入月份，如 202405' : '请继续输入日期，如 20240518' }
  }
  if (compact.length >= 6 && (month < 1 || month > 12)) return invalid()
  if (compact.length === 8 && (day < 1 || day > monthDays(year, month))) return invalid()
  const y = compact.slice(0, 4)
  const m = compact.slice(4, 6)
  const d = compact.slice(6, 8)
  tokens.splice(index, 1)
  return {
    kind: 'date', text: tokens.join(' '),
    start: compact.length === 4 ? `${y}-01-01` : `${y}-${m}-${d || '01'}`,
    end: compact.length === 4 ? `${y}-12-31` : `${y}-${m}-${d || monthDays(year, month)}`,
    label: compact.length === 4 ? `${y}年` : compact.length === 6 ? `${y}年${month}月` : `${y}年${month}月${day}日`,
  }
}

/** 与日志既有日期口径相同，按保存的日历日期匹配，不进行时区或收录时间转换。 */
export function findDateSearchTrades(
  trades: readonly Trade[],
  query: Extract<CommandDateQuery, { kind: 'date' }>,
  strategyNames: ReadonlyMap<string, string>,
): Trade[] {
  return trades.filter((trade) => {
    const date = trade.openedAt.slice(0, 10)
    const parsed = parseCommandDateQuery(date)
    return !trade.deletedAt && parsed.kind === 'date' && date.length === 10
      && date >= query.start && date <= query.end
      && matchesSearchQuery(query.text, trade.ref, trade.symbol, strategyNames.get(trade.strategyId), trade.tags.join(' '))
  }).sort((left, right) => (
    right.openedAt.slice(0, 10).localeCompare(left.openedAt.slice(0, 10)) || left.id.localeCompare(right.id)
  ))
}

export interface CommandSearchSession {
  query: string
  limit: number
  activeId?: string
  scrollTop: number
  origin: { pathname: string; search: string; key: string }
}

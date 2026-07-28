import type { RiskPolicyVersion } from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'

export type LiveCycleScope = 'current' | 'pre-cycle' | 'all'
export type LiveCycleClassification = 'current' | 'pre-cycle' | 'unresolved' | 'not-live'

export interface LiveCyclePreview {
  current: Trade[]
  preCycle: Trade[]
  unresolved: Trade[]
}

export function parseLiveCycleScope(input: string | URLSearchParams): LiveCycleScope {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input
  const value = params.get('liveCycle')
  return value === 'pre-cycle' || value === 'all' ? value : 'current'
}

export function isValidLiveCycleDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    formatYmd(parseLocalDate(value)) === value
}

export function openedTradingDayKey(
  trade: Pick<Trade, 'openedAt' | 'activities'>,
  tradingDayStartHour: number,
): string | null {
  let firstOpenAt = Number.POSITIVE_INFINITY
  for (const activity of trade.activities ?? []) {
    if (activity.kind !== 'status' || activity.status !== 'open') continue
    const timestamp = Date.parse(activity.timestamp)
    if (Number.isFinite(timestamp) && timestamp < firstOpenAt) firstOpenAt = timestamp
  }
  if (Number.isFinite(firstOpenAt)) return getTradingDayKey(new Date(firstOpenAt), tradingDayStartHour)
  if (isValidLiveCycleDayKey(trade.openedAt)) return trade.openedAt
  const timestamp = new Date(trade.openedAt)
  if (Number.isNaN(timestamp.getTime())) return null
  return getTradingDayKey(timestamp, tradingDayStartHour)
}

export function classifyLiveCycleTrade(
  trade: Pick<Trade, 'tradeKind' | 'openedAt' | 'activities'>,
  startTradingDayKey: string | null,
  tradingDayStartHour: number,
): LiveCycleClassification {
  if (trade.tradeKind !== 'live') return 'not-live'
  if (startTradingDayKey === null) return 'current'
  const opened = openedTradingDayKey(trade, tradingDayStartHour)
  if (opened === null) return 'unresolved'
  return opened < startTradingDayKey ? 'pre-cycle' : 'current'
}

export function filterTradesForLiveCycle(
  trades: readonly Trade[],
  scope: LiveCycleScope,
  startTradingDayKey: string | null,
  tradingDayStartHour: number,
): Trade[] {
  const normalizedScope = startTradingDayKey === null && scope === 'pre-cycle'
    ? 'current'
    : scope
  if (normalizedScope === 'all') return [...trades]
  return trades.filter((trade) => {
    const classification = classifyLiveCycleTrade(trade, startTradingDayKey, tradingDayStartHour)
    if (classification === 'not-live') return normalizedScope !== 'pre-cycle'
    if (normalizedScope === 'pre-cycle') return classification === 'pre-cycle'
    return classification === 'current' || classification === 'unresolved'
  })
}

export function buildLiveCyclePreview(
  trades: readonly Trade[],
  startTradingDayKey: string,
  tradingDayStartHour: number,
): LiveCyclePreview {
  const preview: LiveCyclePreview = { current: [], preCycle: [], unresolved: [] }
  for (const trade of trades) {
    if (trade.deletedAt || trade.tradeKind !== 'live') continue
    const classification = classifyLiveCycleTrade(trade, startTradingDayKey, tradingDayStartHour)
    if (classification === 'current') preview.current.push(trade)
    if (classification === 'pre-cycle') preview.preCycle.push(trade)
    if (classification === 'unresolved') preview.unresolved.push(trade)
  }
  return preview
}

export function suggestLiveCycleStartTradingDayKey(
  policies: readonly RiskPolicyVersion[],
): string | null {
  return policies
    .map((policy) => policy.effectiveTradingDay)
    .filter(isValidLiveCycleDayKey)
    .sort((left, right) => left.localeCompare(right))[0] ?? null
}

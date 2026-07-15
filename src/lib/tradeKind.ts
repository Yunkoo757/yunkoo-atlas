import type { SidebarNavId } from '@/lib/sidebarNav'
import type { Trade, TradeKind } from '@/data/trades'
import { normalizeReviewFields } from '@/lib/reviewAnalytics'
import { promoteTradeNotionMeta, promoteTradeSession } from '@/lib/tradeView'
import { normalizeTradeMetrics } from '@/lib/tradeTruth'
import { normalizeInitialStopLoss } from '@/lib/tradeResult'

/** 旧版 practice 与 paper 语义相同，统一为 paper（模拟） */
export function normalizeTradeKind(kind: string | undefined): TradeKind {
  if (kind === 'live') return 'live'
  if (kind === 'case') return 'case'
  return 'paper'
}

export function defaultTradeKindForPath(pathname: string): TradeKind {
  if (pathname.startsWith('/review-cases')) return 'case'
  if (
    pathname.startsWith('/sim') ||
    pathname.startsWith('/paper') ||
    pathname.startsWith('/practice')
  ) {
    return 'paper'
  }
  return 'live'
}

/** “新建交易”排除案例类型，但在模拟工作区仍创建模拟交易。 */
export function newTradeKindForPath(pathname: string): Extract<TradeKind, 'live' | 'paper'> {
  return defaultTradeKindForPath(pathname) === 'paper' ? 'paper' : 'live'
}

export function isReviewCaseTrade(trade: Trade): boolean {
  return trade.tradeKind === 'case'
}

export function isAccountTrade(trade: Trade): boolean {
  return trade.tradeKind === 'live' || trade.tradeKind === 'paper'
}

/** 旧版以 0 表示未填写；载入后统一为真正的缺失值。 */
function normalizeExecutionPlaceholders<T extends Trade>(trade: T): T {
  const entry = trade.entry === 0 ? null : trade.entry
  const size = trade.size === 0 ? null : trade.size
  return entry === trade.entry && size === trade.size
    ? trade
    : { ...trade, entry, size }
}

export function normalizeTrades(trades: Trade[]): Trade[] {
  return trades.map((t) => {
    const tradeKind = normalizeTradeKind(t.tradeKind as string)
    const normalizedKind = tradeKind === t.tradeKind ? t : { ...t, tradeKind }
    return normalizeInitialStopLoss(normalizeTradeMetrics(
      promoteTradeNotionMeta(promoteTradeSession(normalizeReviewFields(
        normalizeExecutionPlaceholders(normalizedKind),
      ))),
    ))
  })
}

/** 侧栏配置升级：practice 合并进 paper（模拟） */
export function normalizeSidebarPins(pins: readonly string[]): SidebarNavId[] {
  const out: SidebarNavId[] = []
  for (const id of pins) {
    if (id === 'practice') {
      if (!out.includes('paper')) out.push('paper')
      continue
    }
    if (id === 'active' || id === 'favorites' || id === 'missed' || id === 'paper') {
      if (!out.includes(id)) out.push(id)
    }
  }
  return out
}

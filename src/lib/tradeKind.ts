import type { SidebarNavId } from '@/lib/sidebarNavContract'
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

export type TradeKindTransitionResult =
  | { ok: true; changed: boolean; trade: Trade }
  | {
      ok: false
      changed: false
      trade: Trade
      reason: 'case-transition-forbidden' | 'non-planned-transition-forbidden'
    }

export function transitionTradeKind(
  trade: Trade,
  target: TradeKind,
): TradeKindTransitionResult {
  if (trade.tradeKind === target) return { ok: true, changed: false, trade }
  if (trade.tradeKind === 'case' || target === 'case') {
    return { ok: false, changed: false, trade, reason: 'case-transition-forbidden' }
  }
  if (trade.status !== 'planned') {
    return { ok: false, changed: false, trade, reason: 'non-planned-transition-forbidden' }
  }
  return { ok: true, changed: true, trade: { ...trade, tradeKind: target } }
}

export function normalizeTrades(trades: Trade[]): Trade[] {
  return trades.map((t) => {
    const tradeKind = normalizeTradeKind(t.tradeKind as string)
    const normalizedKind = tradeKind === t.tradeKind ? t : { ...t, tradeKind }
    return normalizeInitialStopLoss(normalizeTradeMetrics(
      promoteTradeNotionMeta(promoteTradeSession(normalizeReviewFields(normalizedKind))),
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

import type { SidebarNavId } from '@/lib/sidebarNav'
import type { Trade, TradeKind } from '@/data/trades'
import { normalizeReviewFields } from '@/lib/reviewAnalytics'

/** 旧版 practice 与 paper 语义相同，统一为 paper（模拟） */
export function normalizeTradeKind(kind: string | undefined): TradeKind {
  if (kind === 'live') return 'live'
  if (kind === 'case') return 'case'
  return 'paper'
}

export function isReviewCaseTrade(trade: Trade): boolean {
  return trade.tradeKind === 'case'
}

export function isAccountTrade(trade: Trade): boolean {
  return trade.tradeKind === 'live' || trade.tradeKind === 'paper'
}

export function normalizeTrades(trades: Trade[]): Trade[] {
  return trades.map((t) => {
    const tradeKind = normalizeTradeKind(t.tradeKind as string)
    const normalizedKind = tradeKind === t.tradeKind ? t : { ...t, tradeKind }
    return normalizeReviewFields(normalizedKind)
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

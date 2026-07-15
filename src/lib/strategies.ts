import type { Strategy } from '@/data/strategies'
import { DEFAULT_STRATEGIES } from '@/data/strategies'
import type { Trade, TradeKind } from '@/data/trades'
import { isExecutedClosed, isTerminal } from '@/lib/tradeStatus'
import { summarizeStrategyPerformance } from '@/lib/reviewAnalytics'
import { isAccountTrade, normalizeTradeKind } from '@/lib/tradeKind'
import { summarizeTradeResults } from '@/lib/tradeTruth'

export function getStrategy(
  strategies: Strategy[],
  id: string | undefined,
): Strategy | undefined {
  if (!id) return undefined
  return strategies.find((s) => s.id === id)
}

export function getStrategyName(strategies: Strategy[], id: string | undefined): string {
  return getStrategy(strategies, id)?.name ?? '未分类'
}

export function countTradesByStrategy(trades: Trade[], strategyId: string): number {
  return trades.filter((t) => t.strategyId === strategyId && isAccountTrade(t)).length
}

export function sortStrategies(strategies: Strategy[], pinnedIds: string[]): Strategy[] {
  const pinnedSet = new Set(pinnedIds)
  const pinned = pinnedIds
    .map((id) => strategies.find((s) => s.id === id))
    .filter((s): s is Strategy => !!s)
  const unpinned = strategies
    .filter((s) => !pinnedSet.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return [...pinned, ...unpinned]
}

export function computeStrategyStats(
  trades: Trade[],
  strategyId: string,
  options?: { tradeKind?: TradeKind | 'all' },
) {
  const kind = options?.tradeKind ?? 'all'
  const all =
    kind === 'all'
      ? trades.filter((t) => t.strategyId === strategyId && isAccountTrade(t))
      : trades.filter((t) => t.strategyId === strategyId && t.tradeKind === kind)
  const closed = all.filter((t) => isExecutedClosed(t.status))
  const result = summarizeTradeResults(closed)
  return {
    ...summarizeStrategyPerformance(trades, strategyId, options),
    tradeCount: all.length,
    closedCount: result.closedCount,
    winRate: result.winRate ?? 0,
    totalPnl: result.totalPnl,
  }
}

/** 将旧版 trade.strategy（名称字符串）迁移为 strategyId，并补全 tradeKind */
export function migrateTradeStrategy(
  trade: Trade & { strategy?: string },
  strategies: Strategy[],
): Trade {
  let base: Trade & { strategy?: string }
  if (trade.strategyId) {
    base = trade
  } else {
    const legacy = trade.strategy
    if (legacy) {
      const byName = strategies.find((s) => s.name === legacy)
      const byId = strategies.find((s) => s.id === legacy)
      const id = byName?.id ?? byId?.id ?? 'uncategorized'
      const { strategy: _drop, ...rest } = trade as Trade & { strategy?: string }
      base = { ...rest, strategyId: id }
    } else {
      base = { ...trade, strategyId: 'uncategorized' }
    }
  }
  return {
    ...base,
    tradeKind: normalizeTradeKind(base.tradeKind),
    closedAt:
      isTerminal(base.status) && !base.closedAt
        ? base.openedAt
        : base.closedAt,
  }
}

export function migrateTrades(
  trades: (Trade & { strategy?: string })[],
  strategies: Strategy[],
): Trade[] {
  return trades.map((t) => migrateTradeStrategy(t, strategies))
}

export function ensureStrategies(raw: Strategy[] | undefined): Strategy[] {
  if (!raw?.length) return [...DEFAULT_STRATEGIES]
  return raw
}

import type { Strategy } from '@/data/strategies'
import { createDefaultStrategies } from '@/config/defaultProfile'
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

/** 删除策略时需要迁移所有仍引用它的记录，包括案例与回收站记录。 */
export function countStrategyReferences(trades: Trade[], strategyId: string): number {
  return trades.filter((trade) => trade.strategyId === strategyId).length
}

export function formatStrategyMetricCoverage(
  coveredCount: number,
  totalCount: number,
): string | null {
  if (totalCount <= 0 || coveredCount >= totalCount) return null
  return `${Math.max(0, coveredCount)}/${totalCount} 笔可用`
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
  const activeTrades = trades.filter((trade) => !trade.deletedAt)
  const kind = options?.tradeKind ?? 'all'
  const all =
    kind === 'all'
      ? activeTrades.filter((t) => t.strategyId === strategyId && isAccountTrade(t))
      : activeTrades.filter((t) => t.strategyId === strategyId && t.tradeKind === kind)
  const closed = all.filter((t) => isExecutedClosed(t.status))
  const result = summarizeTradeResults(closed)
  const performance = summarizeStrategyPerformance(activeTrades, strategyId, options)
  return {
    ...performance,
    tradeCount: all.length,
    closedCount: result.closedCount,
    evaluatedCount: result.evaluatedCount,
    conflictCount: result.conflictCount,
    pnlCount: result.pnlCount,
    rCount: result.rCount,
    winRate: result.winRate,
    totalPnl: result.pnlCount > 0 ? result.totalPnl : null,
    totalR: result.rCount > 0 ? performance.totalR : null,
  }
}

/** 将旧版 trade.strategy（名称字符串）迁移为 strategyId，并补全 tradeKind */
export function migrateTradeStrategy(
  trade: Trade & { strategy?: string },
  strategies: Strategy[],
): Trade {
  let base: Trade & { strategy?: string }
  if (trade.strategyId && strategies.some((strategy) => strategy.id === trade.strategyId)) {
    base = trade
  } else {
    const legacy = trade.strategy ?? trade.strategyId
    if (legacy) {
      const byName = strategies.find((s) => s.name === legacy)
      const byId = strategies.find((s) => s.id === legacy)
      const id = byName?.id ?? byId?.id ?? strategies[0]?.id ?? 'uncategorized'
      const { strategy: _drop, ...rest } = trade as Trade & { strategy?: string }
      base = { ...rest, strategyId: id }
    } else {
      base = { ...trade, strategyId: strategies[0]?.id ?? 'uncategorized' }
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
  if (raw === undefined) return createDefaultStrategies()
  return raw.map((strategy) => {
    if (!Object.prototype.hasOwnProperty.call(strategy, 'reviewTemplateHtml')) return strategy
    const { reviewTemplateHtml: _legacyTemplate, ...normalized } = strategy as Strategy & {
      reviewTemplateHtml?: unknown
    }
    return normalized
  })
}

/**
 * 修复旧快照中的策略引用：显式空策略的真正空库保持为空；一旦存在记录，
 * 至少物化中性的未分类策略，并把未知引用收敛到真实策略 ID。
 */
export function normalizeTradeStrategyReferences(
  trades: (Trade & { strategy?: string })[],
  rawStrategies: Strategy[] | undefined,
): { trades: Trade[]; strategies: Strategy[] } {
  let strategies = ensureStrategies(rawStrategies)
  if (trades.length > 0 && strategies.length === 0) {
    strategies = createDefaultStrategies()
  }
  return {
    strategies,
    trades: migrateTrades(trades, strategies),
  }
}

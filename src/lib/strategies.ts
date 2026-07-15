import type { Strategy, StrategyVersion } from '@/data/strategies'
import { createStrategyV1, DEFAULT_STRATEGIES } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { isTerminal } from '@/lib/tradeStatus'
import { summarizeStrategyPerformance } from '@/lib/reviewAnalytics'
import { isAccountTrade, normalizeTradeKind } from '@/lib/tradeKind'
import type { AnalyticsTradeKind } from '@/lib/analyticsScope'

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
  options?: { tradeKind?: AnalyticsTradeKind },
) {
  return summarizeStrategyPerformance(trades, strategyId, options)
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
  if (!raw?.length) return [...DEFAULT_STRATEGIES]
  return raw
}

export function ensureStrategyVersionGraph(
  rawStrategies: readonly Strategy[],
  rawVersions: readonly StrategyVersion[] = [],
): { strategies: Strategy[]; strategyVersions: StrategyVersion[] } {
  const strategyIds = new Set(rawStrategies.map((strategy) => strategy.id))
  const versions = rawVersions.filter(
    (version, index, values) =>
      strategyIds.has(version.strategyId) &&
      values.findIndex((candidate) => candidate.id === version.id) === index,
  )
  const versionById = new Map(versions.map((version) => [version.id, version]))
  const strategyVersions = [...versions]
  const strategies = rawStrategies.map((strategy) => {
    const current = strategy.currentVersionId
      ? versionById.get(strategy.currentVersionId)
      : undefined
    if (current?.strategyId === strategy.id) return { ...strategy }
    const created = createStrategyV1(strategy)
    if (!versionById.has(created.version.id)) {
      strategyVersions.push(created.version)
      versionById.set(created.version.id, created.version)
    }
    return created.strategy
  })
  return { strategies, strategyVersions }
}

export function bindTradeStrategyVersions(
  trades: readonly Trade[],
  strategies: readonly Strategy[],
): Trade[] {
  const versionByStrategy = new Map(
    strategies.map((strategy) => [strategy.id, strategy.currentVersionId ?? null]),
  )
  return trades.map((trade) => ({
    ...trade,
    strategyVersionId: trade.strategyId
      ? trade.strategyVersionId ?? versionByStrategy.get(trade.strategyId) ?? null
      : null,
  }))
}

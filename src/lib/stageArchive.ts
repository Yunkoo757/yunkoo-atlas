import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import type { AnalysisScope } from '@/lib/analysisScope'
import { buildDashboardStats } from '@/lib/dashboardStats'
import type { LiveStage } from '@/lib/liveStages'
import type { BusinessDateAnchor } from '@/lib/periods'
import { buildPerformanceSelection } from '@/lib/performanceSelection'
import type { LegacyCashCurrencyAssumption } from '@/storage/types'

export type StageScope =
  | { kind: 'current'; stageId: string }
  | { kind: 'stage'; stageId: string }
  | { kind: 'all-history'; archivedStageIds: ReadonlySet<string> }
  | { kind: 'pending' }

export type StageOwned = {
  liveStageId?: string | null
}

export type StageScopeSurface = 'current' | 'history'

export function resolveStageScope(
  requested: string | null | undefined,
  stages: readonly LiveStage[],
  currentLiveStageId: string,
  surface: StageScopeSurface = 'current',
): StageScope {
  const archivedStageIds = new Set(
    stages.filter((stage) => stage.status === 'archived').map((stage) => stage.id),
  )
  if (surface === 'history') {
    if (requested === 'all-history' || !requested) return { kind: 'all-history', archivedStageIds }
    if (archivedStageIds.has(requested)) return { kind: 'stage', stageId: requested }
    return { kind: 'all-history', archivedStageIds }
  }
  if (requested === 'pending') return { kind: 'pending' }
  if (requested === 'all-history') return { kind: 'all-history', archivedStageIds }
  if (requested && archivedStageIds.has(requested)) return { kind: 'stage', stageId: requested }
  return { kind: 'current', stageId: currentLiveStageId }
}

export function matchesStageScope(entity: StageOwned, scope: StageScope): boolean {
  switch (scope.kind) {
    case 'current':
    case 'stage':
      return entity.liveStageId === scope.stageId
    case 'all-history':
      return typeof entity.liveStageId === 'string' && scope.archivedStageIds.has(entity.liveStageId)
    case 'pending':
      return entity.liveStageId === null
  }
}

export function filterStageTrades(trades: readonly Trade[], scope: StageScope): Trade[] {
  return trades.filter((trade) => trade.tradeKind === 'live' && matchesStageScope(trade, scope))
}

export function filterStageCases(trades: readonly Trade[], scope: StageScope): Trade[] {
  return trades.filter((trade) => trade.tradeKind === 'case' && matchesStageScope(trade, scope))
}

export function filterStageOwnedRecords(trades: readonly Trade[], scope: StageScope): Trade[] {
  return trades.filter((trade) => (
    trade.tradeKind === 'paper' || matchesStageScope(trade, scope)
  ))
}

/** 未应用 stage 的 paper 工作台仍沿用当前实盘策略预览，不扩大到全部历史 live。 */
export function resolveStrategyStageScope(
  stageScope: StageScope | undefined,
  currentLiveStageId: string,
): StageScope {
  return stageScope ?? { kind: 'current', stageId: currentLiveStageId }
}

export function buildStagePerformanceProjection(options: {
  trades: readonly Trade[]
  stageScope?: StageScope
  analysisScope: AnalysisScope
  anchor: BusinessDateAnchor
  legacyCashCurrencyAssumption: LegacyCashCurrencyAssumption | null
}) {
  const liveRecords = options.stageScope
    ? filterStageTrades(options.trades, options.stageScope)
    : options.trades.filter((trade) => trade.tradeKind === 'live')
  const liveIds = new Set(liveRecords.map((trade) => trade.id))
  const records = options.analysisScope.kind === 'live'
    ? liveRecords
    : options.analysisScope.kind === 'paper'
      ? options.trades.filter((trade) => trade.tradeKind === 'paper')
      : options.trades.filter((trade) => trade.tradeKind === 'paper' || liveIds.has(trade.id))
  const selectionInput = {
    scope: options.analysisScope,
    liveScope: null,
    anchor: options.anchor,
    legacyCashCurrencyAssumption: options.legacyCashCurrencyAssumption,
  }
  const performanceSelection = buildPerformanceSelection(records, selectionInput)
  const selection = options.analysisScope.kind !== 'all'
    ? performanceSelection
    : (() => {
        const liveIntegrity = buildPerformanceSelection(liveRecords, {
          ...selectionInput,
          scope: { ...options.analysisScope, kind: 'live' },
        })
        return {
          ...performanceSelection,
          missingCloseDayIds: liveIntegrity.missingCloseDayIds,
          invalidCloseDayIds: liveIntegrity.invalidCloseDayIds,
          futureCloseDayIds: liveIntegrity.futureCloseDayIds,
        }
      })()
  return { records, selection }
}

export function buildStageArchiveOverview(options: {
  trades: readonly Trade[]
  strategies: readonly Strategy[]
  stageScope: StageScope
  anchor: BusinessDateAnchor
  legacyCashCurrencyAssumption: LegacyCashCurrencyAssumption | null
}) {
  const projection = buildStagePerformanceProjection({
    trades: options.trades,
    stageScope: options.stageScope,
    analysisScope: { kind: 'live', range: 'all' },
    anchor: options.anchor,
    legacyCashCurrencyAssumption: options.legacyCashCurrencyAssumption,
  })
  const stats = buildDashboardStats(
    projection.records,
    [...options.strategies],
    projection.selection.eligibleMetricIds,
    options.anchor.tradingDayStartHour,
    projection.selection.pnlIds,
  )
  return {
    summary: buildStageArchiveSummary(options.trades, options.stageScope),
    performance: projection.selection,
    stats,
    strategyStats: stats.strategies.map((strategy) => ({
      ...strategy,
      totalPnl: strategy.pnl,
    })),
  }
}

export interface StageArchiveSummary {
  tradeCount: number
  openCount: number
  closedCount: number
  winCount: number
  lossCount: number
  breakevenCount: number
  pnlCount: number
  totalPnl: number
  rCount: number
  averageR: number | null
  caseCount: number
}

export function buildStageArchiveSummary(
  records: readonly Trade[],
  scope: StageScope,
): StageArchiveSummary {
  const trades = filterStageTrades(records, scope).filter((trade) => !trade.deletedAt)
  const cases = filterStageCases(records, scope).filter((trade) => !trade.deletedAt)
  const closed = trades.filter((trade) => (
    trade.status === 'win' || trade.status === 'loss' || trade.status === 'breakeven'
  ))
  const pnl = closed.flatMap((trade) => trade.pnl === null ? [] : [trade.pnl])
  const rMultiples = closed.flatMap((trade) => trade.rMultiple === null ? [] : [trade.rMultiple])
  return {
    tradeCount: trades.length,
    openCount: trades.filter((trade) => trade.status === 'open' || trade.status === 'planned').length,
    closedCount: closed.length,
    winCount: closed.filter((trade) => trade.status === 'win').length,
    lossCount: closed.filter((trade) => trade.status === 'loss').length,
    breakevenCount: closed.filter((trade) => trade.status === 'breakeven').length,
    pnlCount: pnl.length,
    totalPnl: pnl.reduce((total, value) => total + value, 0),
    rCount: rMultiples.length,
    averageR: rMultiples.length === 0
      ? null
      : rMultiples.reduce((total, value) => total + value, 0) / rMultiples.length,
    caseCount: cases.length,
  }
}

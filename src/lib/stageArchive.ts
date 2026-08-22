import type { Trade } from '@/data/trades'
import type { LiveStage } from '@/lib/liveStages'

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

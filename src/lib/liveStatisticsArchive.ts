import type { Trade } from '@/data/trades'
import {
  resolveLivePerformanceCloseTradingDayKey,
  type LivePerformanceCycle,
  type LivePerformanceCycleBounds,
} from '@/lib/livePerformanceCycles'
import { isExecutedClosed } from '@/lib/tradeStatus'
import { resolveTradeTruth } from '@/lib/tradeTruth'

export type LiveRecordBucket = 'current' | 'archive' | 'pending' | 'excluded'

export type LiveArchiveScope = {
  kind: 'current' | 'archive' | 'all-archives' | 'pending'
  archiveId: string | null
  bounds: LivePerformanceCycleBounds | null
  label: string
  missingRequestedKey?: string | null
}

export type LiveArchiveResultCompleteness = {
  closedCount: number
  validResultCount: number
  conflictCount: number
  missingResultCount: number
  missingCloseDayCount: number
}

export type LiveArchiveSummary = {
  archiveId: string
  startTradingDayKey: string | null
  endExclusiveTradingDayKey: string | null
  trades: Trade[]
  resultCompleteness: LiveArchiveResultCompleteness
  associatedCaseCount: number
}

function boundsFor(cycles: readonly LivePerformanceCycle[], index: number): LivePerformanceCycleBounds {
  return {
    startInclusive: cycles[index]!.startTradingDayKey,
    endExclusive: cycles[index + 1]?.startTradingDayKey ?? null,
  }
}

function dayIsInBounds(day: string, bounds: LivePerformanceCycleBounds): boolean {
  return (bounds.startInclusive === null || day >= bounds.startInclusive)
    && (bounds.endExclusive === null || day < bounds.endExclusive)
}

function latestBounds(cycles: readonly LivePerformanceCycle[]): LivePerformanceCycleBounds | null {
  return cycles.length ? boundsFor(cycles, cycles.length - 1) : null
}

export function resolveLiveArchiveScope(
  cycles: readonly LivePerformanceCycle[],
  requestedKey: string | null | undefined,
): LiveArchiveScope {
  const requested = requestedKey ?? null
  const currentIndex = cycles.length - 1
  if (requested === 'pending') return { kind: 'pending', archiveId: null, bounds: null, label: '待整理' }
  if (requested === 'all-archives' || requested === 'all') {
    return { kind: 'all-archives', archiveId: null, bounds: latestBounds(cycles), label: '全部归档' }
  }
  if (requested === null || requested === 'current' || cycles[currentIndex]?.id === requested) {
    return {
      kind: 'current', archiveId: cycles[currentIndex]?.id ?? null, bounds: latestBounds(cycles), label: '当前实盘',
    }
  }
  const archiveIndex = cycles.findIndex((cycle) => cycle.id === requested)
  if (archiveIndex >= 0) {
    const cycle = cycles[archiveIndex]!
    return { kind: 'archive', archiveId: cycle.id, bounds: boundsFor(cycles, archiveIndex), label: cycle.name }
  }
  return {
    kind: 'all-archives', archiveId: null, bounds: latestBounds(cycles), label: '全部归档', missingRequestedKey: requested,
  }
}

function isVisibleLiveRecord(trade: Trade): boolean {
  return trade.tradeKind === 'live' && trade.deletedAt === undefined
}

function bucketForReliableDay(day: string, cycles: readonly LivePerformanceCycle[]): LiveRecordBucket {
  if (!cycles.length) return 'current'
  return dayIsInBounds(day, latestBounds(cycles)!) ? 'current' : 'archive'
}

export function resolveLiveRecordBucket(
  trade: Trade,
  cycles: readonly LivePerformanceCycle[],
  tradingDayStartHour: number,
): LiveRecordBucket {
  if (!isVisibleLiveRecord(trade)) return 'excluded'
  if (trade.status === 'planned' || trade.status === 'open') return 'current'
  const day = resolveLivePerformanceCloseTradingDayKey(trade, tradingDayStartHour)
  if (trade.status === 'missed' || isExecutedClosed(trade.status)) {
    return day === null ? 'pending' : bucketForReliableDay(day, cycles)
  }
  return 'excluded'
}

function matchesScope(
  trade: Trade,
  scope: LiveArchiveScope,
  tradingDayStartHour: number,
): boolean {
  if (!isVisibleLiveRecord(trade)) return false
  if (scope.kind === 'current' && (trade.status === 'planned' || trade.status === 'open')) return true
  if (!isExecutedClosed(trade.status) && trade.status !== 'missed') return false
  const day = resolveLivePerformanceCloseTradingDayKey(trade, tradingDayStartHour)
  if (scope.kind === 'pending') return day === null
  if (day === null) return false
  if (scope.kind === 'current') return scope.bounds === null || dayIsInBounds(day, scope.bounds)
  if (scope.kind === 'all-archives') return scope.bounds !== null && scope.bounds.startInclusive !== null && day < scope.bounds.startInclusive
  return day !== null && scope.bounds !== null && dayIsInBounds(day, scope.bounds)
}

export function filterLiveLogRecords(
  trades: readonly Trade[],
  scope: LiveArchiveScope,
  tradingDayStartHour: number,
): Trade[] {
  return trades.filter((trade) => matchesScope(trade, scope, tradingDayStartHour))
}

export function filterLivePerformanceRecords(
  trades: readonly Trade[],
  scope: LiveArchiveScope,
  tradingDayStartHour: number,
): Trade[] {
  return filterLiveLogRecords(trades, scope, tradingDayStartHour)
    .filter((trade) => isExecutedClosed(trade.status))
}

export function buildLiveArchiveSummary(
  trades: readonly Trade[],
  cases: readonly Trade[],
  cycle: LivePerformanceCycle,
  cycles: readonly LivePerformanceCycle[],
  tradingDayStartHour: number,
): LiveArchiveSummary {
  const scope = resolveLiveArchiveScope(cycles, cycle.id)
  const archiveTrades = filterLivePerformanceRecords(trades, scope, tradingDayStartHour)
  const sourceIds = new Set(archiveTrades.map((trade) => trade.id))
  const validResultCount = archiveTrades.filter((trade) => resolveTradeTruth(trade).isResultComplete).length
  const conflictCount = archiveTrades.filter((trade) => resolveTradeTruth(trade).hasConflict).length
  const missingResultCount = archiveTrades.filter((trade) => {
    const truth = resolveTradeTruth(trade)
    return !truth.isResultComplete && !truth.hasConflict
  }).length
  const missingCloseDayCount = trades.filter((trade) =>
    isVisibleLiveRecord(trade) && isExecutedClosed(trade.status)
      && resolveLivePerformanceCloseTradingDayKey(trade, tradingDayStartHour) === null,
  ).length
  const associatedCaseCount = cases.filter((candidate) =>
    candidate.tradeKind === 'case' && candidate.deletedAt === undefined && !!candidate.sourceTradeId && sourceIds.has(candidate.sourceTradeId),
  ).length
  return {
    archiveId: cycle.id,
    startTradingDayKey: scope.bounds?.startInclusive ?? null,
    endExclusiveTradingDayKey: scope.bounds?.endExclusive ?? null,
    trades: archiveTrades,
    resultCompleteness: {
      closedCount: archiveTrades.length,
      validResultCount,
      conflictCount,
      missingResultCount,
      missingCloseDayCount,
    },
    associatedCaseCount,
  }
}

import type { Trade } from '@/data/trades'
import { openedTradingDayKey } from '@/lib/liveCycle'
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

export type LiveArchiveProjection = {
  summary: LiveArchiveSummary
  members: Trade[]
}

/** 归档首页中用于表示最早边界之前记录的稳定入口。 */
export const LIVE_ARCHIVE_PRE_CYCLE_ID = 'pre-cycle'

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
  if (requested === LIVE_ARCHIVE_PRE_CYCLE_ID) {
    return {
      kind: 'archive',
      archiveId: LIVE_ARCHIVE_PRE_CYCLE_ID,
      bounds: { startInclusive: null, endExclusive: cycles[0]?.startTradingDayKey ?? null },
      label: '更早记录',
    }
  }
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

function activeMembershipDay(
  trade: Trade,
  tradingDayStartHour: number,
): string | null {
  return openedTradingDayKey(trade, tradingDayStartHour)
}

export function resolveLiveRecordBucket(
  trade: Trade,
  cycles: readonly LivePerformanceCycle[],
  tradingDayStartHour: number,
): LiveRecordBucket {
  if (!isVisibleLiveRecord(trade)) return 'excluded'
  // 计划中/持仓按开仓日归属：重置前开仓的进行中进入历史，不再霸占当前工作面。
  if (trade.status === 'planned' || trade.status === 'open') {
    const day = activeMembershipDay(trade, tradingDayStartHour)
    if (day === null) return 'pending'
    return bucketForReliableDay(day, cycles)
  }
  const day = resolveLivePerformanceCloseTradingDayKey(trade, tradingDayStartHour)
  if (trade.status === 'missed' || isExecutedClosed(trade.status)) {
    return day === null ? 'pending' : bucketForReliableDay(day, cycles)
  }
  return 'excluded'
}

function membershipDayForScope(
  trade: Trade,
  tradingDayStartHour: number,
): string | null {
  if (trade.status === 'planned' || trade.status === 'open') {
    return activeMembershipDay(trade, tradingDayStartHour)
  }
  if (!isExecutedClosed(trade.status) && trade.status !== 'missed') return null
  return resolveLivePerformanceCloseTradingDayKey(trade, tradingDayStartHour)
}

function matchesScope(
  trade: Trade,
  scope: LiveArchiveScope,
  tradingDayStartHour: number,
): boolean {
  if (!isVisibleLiveRecord(trade)) return false
  const day = membershipDayForScope(trade, tradingDayStartHour)
  if (scope.kind === 'pending') {
    if (trade.status === 'planned' || trade.status === 'open') return day === null
    if (!isExecutedClosed(trade.status) && trade.status !== 'missed') return false
    return day === null
  }
  if (trade.status !== 'planned' && trade.status !== 'open'
    && !isExecutedClosed(trade.status) && trade.status !== 'missed') {
    return false
  }
  if (day === null) return false
  if (scope.kind === 'current') return scope.bounds === null || dayIsInBounds(day, scope.bounds)
  if (scope.kind === 'all-archives') {
    return scope.bounds !== null && scope.bounds.startInclusive !== null && day < scope.bounds.startInclusive
  }
  return scope.bounds !== null && dayIsInBounds(day, scope.bounds)
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
    .filter((trade) => isExecutedClosed(trade.status) && resolveTradeTruth(trade).isResultComplete)
}

export function buildLiveArchiveSummary(
  trades: readonly Trade[],
  cases: readonly Trade[],
  cycle: LivePerformanceCycle,
  cycles: readonly LivePerformanceCycle[],
  tradingDayStartHour: number,
  precomputedLogRecords?: readonly Trade[],
): LiveArchiveSummary {
  const scope = resolveLiveArchiveScope(cycles, cycle.id)
  const archiveLogRecords = precomputedLogRecords ? [...precomputedLogRecords] : filterLiveLogRecords(trades, scope, tradingDayStartHour)
  const archiveClosedRecords = archiveLogRecords.filter((trade) => isExecutedClosed(trade.status))
  const archiveTrades = archiveLogRecords.filter((trade) => isExecutedClosed(trade.status) && resolveTradeTruth(trade).isResultComplete)
  const sourceIds = new Set(archiveLogRecords.map((trade) => trade.id))
  const validResultCount = archiveClosedRecords.filter((trade) => resolveTradeTruth(trade).isResultComplete).length
  const conflictCount = archiveClosedRecords.filter((trade) => resolveTradeTruth(trade).hasConflict).length
  const missingResultCount = archiveClosedRecords.filter((trade) => {
    const truth = resolveTradeTruth(trade)
    return !truth.isResultComplete && !truth.hasConflict
  }).length
  const missingCloseDayCount = archiveClosedRecords.filter((trade) =>
    resolveLivePerformanceCloseTradingDayKey(trade, tradingDayStartHour) === null,
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
      closedCount: archiveClosedRecords.length,
      validResultCount,
      conflictCount,
      missingResultCount,
      missingCloseDayCount,
    },
    associatedCaseCount,
  }
}

export function buildLiveArchiveProjection(
  trades: readonly Trade[],
  cases: readonly Trade[],
  cycle: LivePerformanceCycle,
  cycles: readonly LivePerformanceCycle[],
  tradingDayStartHour: number,
): LiveArchiveProjection {
  const scope = resolveLiveArchiveScope(cycles, cycle.id)
  const members = filterLiveLogRecords(trades, scope, tradingDayStartHour)
  return {
    members,
    summary: buildLiveArchiveSummary(trades, cases, cycle, cycles, tradingDayStartHour, members),
  }
}

/**
 * 列出所有有日志成员的历史归档：包括最早边界之前的隐式归档，且不把最新边界当作历史卡片。
 * 页面只消费此投影，不自行推导日期边界。
 */
export function listLiveArchiveProjections(
  trades: readonly Trade[],
  cases: readonly Trade[],
  cycles: readonly LivePerformanceCycle[],
  tradingDayStartHour: number,
): LiveArchiveProjection[] {
  if (cycles.length === 0) return []
  const preCycle: LivePerformanceCycle = {
    id: LIVE_ARCHIVE_PRE_CYCLE_ID,
    name: '更早记录',
    startTradingDayKey: cycles[0]!.startTradingDayKey,
    createdAt: cycles[0]!.createdAt,
  }
  return [preCycle, ...cycles.slice(0, -1)]
    .map((cycle) => buildLiveArchiveProjection(trades, cases, cycle, cycles, tradingDayStartHour))
    .filter((projection) => projection.members.length > 0)
    .reverse()
}

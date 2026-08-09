import type { Trade } from '@/data/trades'
import { isCanonicalIsoInstant } from '@/lib/isoInstant'
import { isValidLiveCycleDayKey } from '@/lib/liveCycle'
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
import { isExecutedClosed } from '@/lib/tradeStatus'

export type LivePerformanceCycle = {
  id: string
  name: string
  startTradingDayKey: string
  createdAt: string
}

export const LIVE_PERFORMANCE_CYCLE_RESERVED_IDS = {
  all: 'all',
  preCycle: 'pre-cycle',
  current: 'current',
} as const

const RESERVED_CYCLE_IDS = new Set<string>(Object.values(LIVE_PERFORMANCE_CYCLE_RESERVED_IDS))

export function isReservedLivePerformanceCycleId(value: string): boolean {
  return RESERVED_CYCLE_IDS.has(value)
}

export type LivePerformanceCycleBounds = {
  startInclusive: string | null
  endExclusive: string | null
}

export type ResolvedLivePerformanceCycle = {
  key: 'all' | 'pre-cycle' | string
  cycleId: string | null
  label: string
  bounds: LivePerformanceCycleBounds | null
  isCurrent: boolean
  requestedKey: string | null
  wasFallback: boolean
}

function assertValidCycleName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 40) {
    throw new Error('周期名称必须为 1 至 40 个字符')
  }
}

function assertValidCycle(value: unknown): asserts value is LivePerformanceCycle {
  if (!value || typeof value !== 'object') throw new Error('周期必须是对象')
  const cycle = value as Record<string, unknown>
  if (typeof cycle.id !== 'string' || !cycle.id || cycle.id.trim() !== cycle.id) {
    throw new Error('周期 ID 必须为无首尾空格的非空字符串')
  }
  if (isReservedLivePerformanceCycleId(cycle.id)) throw new Error('周期 ID 不得使用路由保留值')
  assertValidCycleName(cycle.name)
  if (!isValidLiveCycleDayKey(cycle.startTradingDayKey)) throw new Error('周期起始交易日无效')
  if (!isCanonicalIsoInstant(cycle.createdAt)) throw new Error('周期创建时间必须是 ISO 时间戳')
}

export function assertValidLivePerformanceCycles(value: unknown): asserts value is LivePerformanceCycle[] {
  if (!Array.isArray(value)) throw new Error('实盘统计周期必须是数组')
  const ids = new Set<string>()
  const names = new Set<string>()
  let previousStart: string | null = null
  for (const cycle of value) {
    assertValidCycle(cycle)
    if (ids.has(cycle.id)) throw new Error('周期 ID 不可重复')
    if (names.has(cycle.name)) throw new Error('周期名称不可重复')
    if (previousStart !== null && cycle.startTradingDayKey <= previousStart) {
      throw new Error('周期必须按起始交易日严格升序排列')
    }
    ids.add(cycle.id)
    names.add(cycle.name)
    previousStart = cycle.startTradingDayKey
  }
}

export function cloneLivePerformanceCycles(value: readonly LivePerformanceCycle[] = []): LivePerformanceCycle[] {
  assertValidLivePerformanceCycles(value)
  return value.map((cycle) => ({ ...cycle }))
}

function resolvedAll(requestedKey: string | null, wasFallback: boolean): ResolvedLivePerformanceCycle {
  return {
    key: 'all', cycleId: null, label: '全部实盘', bounds: null,
    isCurrent: false, requestedKey, wasFallback,
  }
}

function resolvedCycle(
  cycles: readonly LivePerformanceCycle[],
  index: number,
  requestedKey: string | null,
  wasFallback: boolean,
): ResolvedLivePerformanceCycle {
  const cycle = cycles[index]!
  return {
    key: cycle.id,
    cycleId: cycle.id,
    label: cycle.name,
    bounds: { startInclusive: cycle.startTradingDayKey, endExclusive: cycles[index + 1]?.startTradingDayKey ?? null },
    isCurrent: index === cycles.length - 1,
    requestedKey,
    wasFallback,
  }
}

export function resolveLivePerformanceCycle(
  cycles: readonly LivePerformanceCycle[],
  requested: string | null,
): ResolvedLivePerformanceCycle {
  assertValidLivePerformanceCycles(cycles)
  if (cycles.length === 0) {
    return resolvedAll(
      requested,
      requested !== null && requested !== LIVE_PERFORMANCE_CYCLE_RESERVED_IDS.all,
    )
  }
  if (requested === LIVE_PERFORMANCE_CYCLE_RESERVED_IDS.all) return resolvedAll(requested, false)
  if (requested === LIVE_PERFORMANCE_CYCLE_RESERVED_IDS.preCycle) {
    return {
      key: 'pre-cycle', cycleId: null, label: '周期前',
      bounds: { startInclusive: null, endExclusive: cycles[0]!.startTradingDayKey },
      isCurrent: false, requestedKey: requested, wasFallback: false,
    }
  }
  if (requested === null) return resolvedCycle(cycles, cycles.length - 1, requested, false)
  const index = cycles.findIndex((cycle) => cycle.id === requested)
  return index >= 0
    ? resolvedCycle(cycles, index, requested, false)
    : resolvedCycle(cycles, cycles.length - 1, requested, true)
}

function isEligibleLiveClosedTrade(trade: Trade): boolean {
  return trade.tradeKind === 'live' && trade.deletedAt === undefined && isExecutedClosed(trade.status)
}

function isEligibleLivePendingTrade(trade: Trade): boolean {
  return trade.tradeKind === 'live'
    && trade.deletedAt === undefined
    && (trade.status === 'missed' || isExecutedClosed(trade.status))
}

/**
 * 归档与周期筛选共用的可靠平仓业务日：已冻结字段优先，旧记录才从 closedAt 补算。
 * 一旦已存在冻结字段，即使其无效也绝不可回退，避免静默改写历史归属。
 */
export function resolveLivePerformanceCloseTradingDayKey(
  trade: Trade,
  tradingDayStartHour: number,
): string | null {
  if (trade.closedTradingDayKey !== undefined) {
    return isValidLiveCycleDayKey(trade.closedTradingDayKey) ? trade.closedTradingDayKey : null
  }
  const day = closedTradingDayKeyFromClosedAt(trade.closedAt, tradingDayStartHour)
  return day !== null && isValidLiveCycleDayKey(day) ? day : null
}

export function filterTradesByLivePerformanceCycle(
  trades: readonly Trade[],
  resolved: ResolvedLivePerformanceCycle,
  tradingDayStartHour: number,
): Trade[] {
  if (resolved.bounds === null) return trades.filter(isEligibleLiveClosedTrade)
  const { startInclusive, endExclusive } = resolved.bounds
  return trades.filter((trade) => {
    if (!isEligibleLiveClosedTrade(trade)) return false
    const day = resolveLivePerformanceCloseTradingDayKey(trade, tradingDayStartHour)
    if (day === null) return false
    return (startInclusive === null || day >= startInclusive) && (endExclusive === null || day < endExclusive)
  })
}

export function countLiveTradesMissingCloseDay(
  trades: readonly Trade[],
  tradingDayStartHour: number,
): number {
  return trades.filter((trade) => isEligibleLivePendingTrade(trade) && resolveLivePerformanceCloseTradingDayKey(trade, tradingDayStartHour) === null).length
}

export function appendLivePerformanceCycle(
  cycles: readonly LivePerformanceCycle[],
  cycle: LivePerformanceCycle,
  currentTradingDayKey: string,
): LivePerformanceCycle[] {
  assertValidLivePerformanceCycles(cycles)
  assertValidCycle(cycle)
  if (!isValidLiveCycleDayKey(currentTradingDayKey)) throw new Error('当前交易日无效')
  if (cycle.startTradingDayKey > currentTradingDayKey) throw new Error('周期起始日不得晚于当前交易日')
  const latest = cycles.at(-1)
  if (latest && cycle.startTradingDayKey <= latest.startTradingDayKey) throw new Error('周期起始日必须晚于最新边界')
  const next = [...cloneLivePerformanceCycles(cycles), { ...cycle }]
  assertValidLivePerformanceCycles(next)
  return next
}

/** 重置实盘统计：只保留一条新起点，旧多轮边界折叠进统一「重置前」历史。 */
export function createLiveStatisticsResetEpoch(
  startTradingDayKey: string,
  currentTradingDayKey: string,
  createdAt: string,
  id: string,
): LivePerformanceCycle[] {
  if (!isValidLiveCycleDayKey(currentTradingDayKey)) throw new Error('当前交易日无效')
  if (!isValidLiveCycleDayKey(startTradingDayKey)) throw new Error('重置起点交易日无效')
  if (startTradingDayKey > currentTradingDayKey) throw new Error('重置起点不得晚于当前交易日')
  const cycle: LivePerformanceCycle = {
    id,
    name: `实盘统计 ${startTradingDayKey}`,
    startTradingDayKey,
    createdAt,
  }
  assertValidCycle(cycle)
  return [cycle]
}

export function renameLivePerformanceCycle(
  cycles: readonly LivePerformanceCycle[],
  id: string,
  name: string,
): LivePerformanceCycle[] {
  assertValidLivePerformanceCycles(cycles)
  assertValidCycleName(name)
  const index = cycles.findIndex((cycle) => cycle.id === id)
  if (index < 0) throw new Error('找不到周期')
  if (cycles.some((cycle, candidateIndex) => candidateIndex !== index && cycle.name === name)) {
    throw new Error('周期名称不可重复')
  }
  return cycles.map((cycle, candidateIndex) => candidateIndex === index ? { ...cycle, name } : { ...cycle })
}

export function undoLatestLivePerformanceCycle(
  cycles: readonly LivePerformanceCycle[],
): LivePerformanceCycle[] {
  assertValidLivePerformanceCycles(cycles)
  return cycles.slice(0, -1).map((cycle) => ({ ...cycle }))
}

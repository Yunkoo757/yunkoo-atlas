import type { PersistedSnapshot } from '@/storage/types'
import { isTradeResultAuthorityConsistent } from '@/lib/tradeTruth'

const TRADE_SIDES = new Set(['long', 'short'])
const TRADE_STATUSES = new Set(['planned', 'open', 'missed', 'win', 'loss', 'breakeven'])
const TRADE_KINDS = new Set(['live', 'paper', 'case'])
const CONVICTIONS = new Set(['low', 'medium', 'high', 'urgent'])
const RESULT_SOURCES = new Set(['pnl', 'r', 'price', 'imported'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isTrade(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    typeof value.ref !== 'string' ||
    typeof value.symbol !== 'string' ||
    typeof value.strategyId !== 'string' ||
    typeof value.openedAt !== 'string' ||
    !TRADE_SIDES.has(String(value.side)) ||
    !TRADE_STATUSES.has(String(value.status)) ||
    !CONVICTIONS.has(String(value.conviction)) ||
    !isNullableFiniteNumber(value.entry) ||
    !isNullableFiniteNumber(value.size)
  ) return false
  if (value.tradeKind !== undefined && !TRADE_KINDS.has(String(value.tradeKind))) return false
  if (value.tags !== undefined && !isStringArray(value.tags)) return false
  if (value.mistakeTags !== undefined && !isStringArray(value.mistakeTags)) return false
  if (value.note !== undefined && typeof value.note !== 'string') return false
  if (value.exit !== undefined && !isNullableFiniteNumber(value.exit)) return false
  if (value.pnl !== undefined && !isNullableFiniteNumber(value.pnl)) return false
  if (value.rMultiple !== undefined && !isNullableFiniteNumber(value.rMultiple)) return false
  if (value.stopLoss !== undefined && !isNullableFiniteNumber(value.stopLoss)) return false
  if (value.initialStopLoss !== undefined && !isNullableFiniteNumber(value.initialStopLoss)) return false
  if (value.resultSource !== undefined && !RESULT_SOURCES.has(String(value.resultSource))) return false
  if (!isTradeResultAuthorityConsistent(value)) return false
  if (value.closedAt !== undefined && value.closedAt !== null && typeof value.closedAt !== 'string') return false
  if (value.reviewedAt !== undefined && value.reviewedAt !== null && typeof value.reviewedAt !== 'string') return false
  return true
}

function isStrategy(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.color === 'string'
  )
}

export function assertValidPersistedSnapshot(
  value: unknown,
  label = 'snapshot',
): asserts value is PersistedSnapshot {
  if (!isRecord(value) || !Array.isArray(value.trades) || !Array.isArray(value.strategies)) {
    throw new Error(`${label} is missing trades or strategies`)
  }
  if (!value.trades.every(isTrade)) throw new Error(`${label} contains an invalid trade`)
  if (!value.strategies.every(isStrategy)) throw new Error(`${label} contains an invalid strategy`)
  for (const field of ['starredIds', 'subscribedIds', 'pinnedStrategyIds', 'tagPresets', 'mistakeTagPresets']) {
    if (value[field] !== undefined && !isStringArray(value[field])) {
      throw new Error(`${label}.${field} must be a string array`)
    }
  }
}

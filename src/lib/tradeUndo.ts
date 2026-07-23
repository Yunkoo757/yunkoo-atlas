import type { Trade } from '@/data/trades'

export interface UndoFieldPatch {
  key: keyof Trade
  before: unknown
  after: unknown
}

export interface UndoTradePatch {
  id: string
  fields: readonly UndoFieldPatch[]
}

export interface UndoAction {
  actionId: string
  label: string
  createdAt: string
  trades: readonly UndoTradePatch[]
}

export type UndoDirection = 'undo' | 'redo'

export type ApplyUndoResult =
  | { ok: true; trades: Trade[] }
  | {
      ok: false
      code: 'undo-conflict'
      trades: readonly Trade[]
      reason: 'missing-trade' | 'field-conflict'
      tradeId: string
      key?: keyof Trade
    }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function undoValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => undoValuesEqual(value, right[index]))
  }
  if (!isObject(left) || !isObject(right)) return false
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!undoValuesEqual(left[key], right[key])) return false
  }
  return true
}

function cloneUndoValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneUndoValue) as T
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneUndoValue(item)]),
  ) as T
}

function assertUniqueTradeIds(trades: readonly Trade[], label: string): void {
  const ids = new Set<string>()
  for (const trade of trades) {
    if (ids.has(trade.id)) throw new Error(`${label} contains duplicate trade id: ${trade.id}`)
    ids.add(trade.id)
  }
}

export function buildUndoAction(input: {
  actionId: string
  label: string
  createdAt: string
  before: readonly Trade[]
  after: readonly Trade[]
}): UndoAction | null {
  if (!input.actionId.trim()) throw new Error('Undo actionId is required')
  assertUniqueTradeIds(input.before, 'Undo before state')
  assertUniqueTradeIds(input.after, 'Undo after state')
  const afterById = new Map(input.after.map((trade) => [trade.id, trade]))
  if (input.before.length !== input.after.length) {
    throw new Error('Undo actions cannot create or remove trades')
  }

  const trades: UndoTradePatch[] = []
  for (const before of input.before) {
    const after = afterById.get(before.id)
    if (!after) throw new Error(`Undo action is missing after state for trade: ${before.id}`)
    const keys = new Set<keyof Trade>([
      ...(Object.keys(before) as Array<keyof Trade>),
      ...(Object.keys(after) as Array<keyof Trade>),
    ])
    const fields: UndoFieldPatch[] = []
    for (const key of keys) {
      if (undoValuesEqual(before[key], after[key])) continue
      fields.push({
        key,
        before: cloneUndoValue(before[key]),
        after: cloneUndoValue(after[key]),
      })
    }
    if (fields.length > 0) trades.push({ id: before.id, fields })
  }

  if (trades.length === 0) return null
  return {
    actionId: input.actionId,
    label: input.label,
    createdAt: input.createdAt,
    trades,
  }
}

export function applyUndoAction(
  currentTrades: readonly Trade[],
  action: UndoAction,
  direction: UndoDirection,
): ApplyUndoResult {
  const currentById = new Map(currentTrades.map((trade) => [trade.id, trade]))
  const expectedSide = direction === 'undo' ? 'after' : 'before'
  const targetSide = direction === 'undo' ? 'before' : 'after'

  for (const patch of action.trades) {
    const current = currentById.get(patch.id)
    if (!current) {
      return { ok: false, code: 'undo-conflict', trades: currentTrades, reason: 'missing-trade', tradeId: patch.id }
    }
    for (const field of patch.fields) {
      if (!undoValuesEqual(current[field.key], field[expectedSide])) {
        return {
          ok: false,
          code: 'undo-conflict',
          trades: currentTrades,
          reason: 'field-conflict',
          tradeId: patch.id,
          key: field.key,
        }
      }
    }
  }

  const patchesById = new Map(action.trades.map((patch) => [patch.id, patch]))
  return {
    ok: true,
    trades: currentTrades.map((trade) => {
      const patch = patchesById.get(trade.id)
      if (!patch) return trade
      const next = { ...trade }
      for (const field of patch.fields) {
        Object.assign(next, { [field.key]: cloneUndoValue(field[targetSide]) })
      }
      return next
    }),
  }
}

import type { Trade } from '@/data/trades'
import { buildUndoAction, type UndoAction } from '@/lib/tradeUndo'

export function appendBoundedHistory(stack: readonly UndoAction[], action: UndoAction): UndoAction[] {
  return [...stack.slice(-49), action]
}

let undoActionSequence = 0

function nextUndoActionId(): string {
  undoActionSequence += 1
  return `undo-${Date.now().toString(36)}-${undoActionSequence.toString(36)}`
}

export function createStoreUndoAction(
  label: string,
  before: readonly Trade[],
  after: readonly Trade[],
): UndoAction | null {
  return buildUndoAction({
    actionId: nextUndoActionId(),
    label,
    createdAt: new Date().toISOString(),
    before,
    after,
  })
}

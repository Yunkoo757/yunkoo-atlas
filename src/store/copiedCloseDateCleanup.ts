import {
  commitCopiedCloseDateCleanupThroughBoundary,
  commitCopiedCloseDateUndoThroughBoundary,
  type CommitCopiedCloseDateCleanupResult,
  type CommitCopiedCloseDateUndoResult,
  type CopiedCloseDatePersistenceBoundary,
} from '@/lib/importDataHealth'
import type { UndoAction } from '@/lib/tradeUndo'
import { flushStorageBeforeCutover, lockStorageCutoverInteraction } from '@/storage/cutover'
import { pickPersisted } from '@/storage/snapshotProjection'
import { suspendPersist } from '@/storage/persist'
import { getStorage } from '@/storage/provider'
import { getJournalBridge } from '@/storage/runtime'
import type { PersistedSnapshot } from '@/storage/types'
import { useShortcutStore } from './shortcutStore'
import { appendBoundedHistory, createStoreUndoAction } from './tradeHistory'
import type { useStore } from './useStore'

type CleanupStore = Pick<typeof useStore, 'getState' | 'setState'>

const cleanupLabel = '清空污染平仓日'

export interface ImportDataHealthStoreDependencies {
  boundary: CopiedCloseDatePersistenceBoundary
  persistSnapshot: (snapshot: PersistedSnapshot) => Promise<void>
}

function desktopDependencies(
  operation: '清理' | '撤销',
  recoverDurableSnapshot: CopiedCloseDatePersistenceBoundary['recoverDurableSnapshot'],
): ImportDataHealthStoreDependencies {
  return {
    persistSnapshot: snapshot => getStorage().commitImport(snapshot, []),
    boundary: {
      lockInteraction: lockStorageCutoverInteraction,
      flushBeforeCommit: flushStorageBeforeCutover,
      createVerifiedBackup: async () => {
        const bridge = getJournalBridge()
        if (!bridge) throw new Error(`历史日期${operation}只能在 Windows 或 macOS 客户端执行`)
        const backupName = await bridge.createBackup()
        if (!backupName) throw new Error(`无法创建${operation}前备份`)
        const verification = await bridge.verifyBackup(backupName)
        if (verification.status !== 'verified') throw new Error(verification.error ?? `${operation}前备份验证失败`)
      },
      suspendPersist,
      recoverDurableSnapshot,
    },
  }
}

function captureLatest(store: CleanupStore) {
  const state = store.getState()
  return { trades: state.trades, snapshot: pickPersisted(state, useShortcutStore.getState().bindings) }
}

/** 发布失败时只同步本流程已经耐久提交的交易，并保留会话内其他撤销历史。 */
export function recoverCopiedCloseDateCleanupToStore(
  store: CleanupStore,
  snapshot: PersistedSnapshot,
  action: UndoAction,
): void {
  store.setState((state) => ({
    trades: [...snapshot.trades],
    undoStack: state.undoStack.some((candidate) => candidate.actionId === action.actionId)
      ? state.undoStack
      : appendBoundedHistory(state.undoStack, action),
    redoStack: state.redoStack,
  }))
}

/** 撤销发布失败时按耐久结果完成同一 action 的栈迁移，不执行整库切换 reset。 */
function recoverCopiedCloseDateUndoToStore(
  store: CleanupStore,
  snapshot: PersistedSnapshot,
  action: UndoAction,
): void {
  store.setState((state) => ({
    trades: [...snapshot.trades],
    undoStack: state.undoStack.filter((candidate) => candidate.actionId !== action.actionId),
    redoStack: state.redoStack.some((candidate) => candidate.actionId === action.actionId)
      ? state.redoStack
      : appendBoundedHistory(state.redoStack, action),
  }))
}

export async function cleanupCopiedCloseDates(
  store: CleanupStore,
  tradeIds: readonly string[],
  dependencies?: ImportDataHealthStoreDependencies,
): Promise<CommitCopiedCloseDateCleanupResult & { actionId?: string }> {
  let action: UndoAction | undefined
  const storage = dependencies ?? desktopDependencies('清理', snapshot => {
    if (!action) throw new Error('耐久清理缺少可撤销 action')
    recoverCopiedCloseDateCleanupToStore(store, snapshot, action)
  })
  const result = await commitCopiedCloseDateCleanupThroughBoundary({
    cleanup: {
      tradeIds,
      tradingDayStartHour: store.getState().display.tradingDayStartHour,
      captureLatest: () => captureLatest(store),
      persistSnapshot: async (snapshot, { before, after }) => {
        const prepared = createStoreUndoAction(cleanupLabel, before, after)
        if (!prepared) throw new Error('清理候选没有产生可撤销字段变化')
        action = prepared
        await storage.persistSnapshot(snapshot)
      },
      publish: trades => {
        const committed = action
        if (!committed) throw new Error('清理候选缺少已提交的可撤销 action')
        store.setState(state => ({
          trades,
          undoStack: appendBoundedHistory(state.undoStack, committed),
          redoStack: [],
        }))
      },
    },
    boundary: storage.boundary,
  })
  return result.kind === 'committed' ? { ...result, actionId: action?.actionId } : result
}

export async function undoCopiedCloseDateCleanup(
  store: CleanupStore,
  action: UndoAction,
  dependencies?: ImportDataHealthStoreDependencies,
): Promise<CommitCopiedCloseDateUndoResult> {
  if (action.label !== cleanupLabel) return { kind: 'stale-action' }
  const storage = dependencies ?? desktopDependencies('撤销', snapshot => recoverCopiedCloseDateUndoToStore(store, snapshot, action))
  return commitCopiedCloseDateUndoThroughBoundary({
    undo: {
      action,
      captureLatest: () => captureLatest(store),
      persistSnapshot: storage.persistSnapshot,
      publish: trades => store.setState(state => ({
        trades,
        undoStack: state.undoStack.filter(candidate => candidate.actionId !== action.actionId),
        redoStack: appendBoundedHistory(state.redoStack, action),
      })),
    },
    boundary: storage.boundary,
  })
}

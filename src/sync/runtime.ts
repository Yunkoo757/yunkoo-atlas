import { applySnapshotToStore } from '@/lib/importExport'
import { getJournalBridge } from '@/storage/runtime'
import {
  flushPersistNow,
  pickPersisted,
  resumePersistAndFlush,
  suspendPersist,
} from '@/storage/persist'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { mergeAcceptedRemoteOperations } from '@/sync/remoteApply'
import { applySnapshotMutation } from '@/sync/remoteApply'
import { collectSnapshotMutations } from '@/sync/localJournal'
import type { CloudSyncExecution } from '@/sync/cloudSync'

let activeExecution: Promise<CloudSyncExecution> | null = null

function currentSnapshot() {
  return pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
}

export function mergeAuthoritativeSnapshot(
  baseline: ReturnType<typeof currentSnapshot>,
  current: ReturnType<typeof currentSnapshot>,
  authoritative: ReturnType<typeof currentSnapshot>,
): ReturnType<typeof currentSnapshot> {
  return collectSnapshotMutations(baseline, current).reduce(
    (snapshot, mutation) => applySnapshotMutation(snapshot, mutation),
    authoritative,
  )
}

export function runCloudSyncWithLocalMerge(
  action: () => Promise<CloudSyncExecution>,
): Promise<CloudSyncExecution> {
  if (activeExecution) return activeExecution
  const operation = (async () => {
    await flushPersistNow()
    const baseline = currentSnapshot()
    suspendPersist()
    try {
      const execution = await action()
      if (execution.authoritativeSnapshot) {
        applySnapshotToStore(mergeAuthoritativeSnapshot(
          baseline,
          currentSnapshot(),
          execution.authoritativeSnapshot,
        ))
      } else if (execution.appliedOperations.length > 0) {
        const merged = mergeAcceptedRemoteOperations(
          baseline,
          currentSnapshot(),
          execution.appliedOperations,
        )
        applySnapshotToStore(merged.snapshot)
      }
      return execution
    } finally {
      await resumePersistAndFlush()
    }
  })().finally(() => {
    if (activeExecution === operation) activeExecution = null
  })
  activeExecution = operation
  return operation
}

export function requestCloudSyncNow(): Promise<CloudSyncExecution> {
  const bridge = getJournalBridge()
  if (!bridge) throw new Error('云同步仅在桌面版中可用')
  return runCloudSyncWithLocalMerge(() => bridge.runCloudSyncNow())
}

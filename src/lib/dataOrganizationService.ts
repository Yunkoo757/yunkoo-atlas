import { prepareAutomaticStageOwnership } from '@/lib/stageOwnershipRepair'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import type { PersistedSnapshot } from '@/storage/types'
import { commitDataOrganization, prepareDataOrganization, type DataOrganizationRequest } from '@/lib/dataOrganization'
import { getStorage } from '@/storage'
import { getJournalBridge } from '@/storage/runtime'
import { flushStorageBeforeCutover, isStorageCutoverInteractionLocked, lockStorageCutoverInteraction } from '@/storage/cutover'
import { pickPersisted, suspendPersist, resumePersist, discardPendingAndResumePersist, disablePersistWrites } from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { useSaveStatus } from '@/store/saveStatus'
import { applySnapshotToStore, clearSessionUiAfterLibrarySwitch } from '@/lib/snapshotStore'
import { notifyStorageRecoveryRequired } from '@/lib/storageRecovery'
import { clearReviewSessionFilters, clearReviewSessionStorage } from '@/lib/reviewSession'

export function captureOrganizationSnapshot() {
  return pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
}

let running = false
export async function organizeLibrary(expected: string, request: DataOrganizationRequest, day: string, expectedLibraryId: string) {
  return commitLibraryOrganization(expected, before => prepareDataOrganization(before, request, day, new Date().toISOString(), crypto.randomUUID()), expectedLibraryId)
}
export async function repairLibraryStageOwnership(expected: string, expectedLibraryId: string) {
  return commitLibraryOrganization(expected, before => {
    const result = prepareAutomaticStageOwnership({ ...before, weeklyReviews: before.weeklyReviews ?? [] })
    if (!result.count) throw new Error('没有可自动修复的记录。')
    assertValidPersistedSnapshot(result.snapshot)
    return result.snapshot
  }, expectedLibraryId)
}
async function commitLibraryOrganization(expected: string, makeCandidate: (before: PersistedSnapshot) => PersistedSnapshot, expectedLibraryId: string) {
  if (running || isStorageCutoverInteractionLocked()) throw new Error('已有资料库操作正在执行，请稍后重试。')
  const bridge = getJournalBridge()
  if (!bridge) throw new Error('数据整理仅支持 Windows / macOS 客户端。')
  running = true
  let published = false
  let halted = false
  let recoveryMessage = ''
  try {
    const storage = getStorage()
    const manifest = await storage.getManifest()
    if (manifest.libraryId !== expectedLibraryId || isStorageCutoverInteractionLocked()) throw new Error('资料库或操作状态已变化，请重新预览。')
    return await commitDataOrganization(expected,
      makeCandidate, {
        lock: lockStorageCutoverInteraction,
        flush: flushStorageBeforeCutover,
        capture: captureOrganizationSnapshot,
        suspend: suspendPersist,
        resume: () => {
          if (published || halted) {
            discardPendingAndResumePersist()
            if (halted) useSaveStatus.getState().setError(recoveryMessage)
          }
          else resumePersist({ flushNow: true })
        },
        backup: async () => {
          if ((await storage.getManifest()).libraryId !== manifest.libraryId) throw new Error('当前资料库已切换，请重新确认。')
          const name = await bridge.createBackup()
          if (!name) throw new Error('整理前备份未创建，已取消操作。')
          const verification = await bridge.verifyBackup(name)
          if (verification.status !== 'verified') throw new Error(verification.error ?? '整理前备份校验失败，已取消操作。')
          return name
        },
        persist: snapshot => storage.commitImport(snapshot, [], { pruneUnreferenced: false }),
        publish: snapshot => {
          applySnapshotToStore(snapshot)
          clearSessionUiAfterLibrarySwitch()
          clearReviewSessionStorage(manifest.libraryId)
          clearReviewSessionFilters(manifest.libraryId)
          published = true
        },
        halt: message => {
          halted = true
          recoveryMessage = message
          disablePersistWrites()
          useSaveStatus.getState().setError(message)
          notifyStorageRecoveryRequired(message)
        },
      })
  } finally { running = false }
}

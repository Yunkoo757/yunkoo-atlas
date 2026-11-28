import { prepareResultConflictRepair } from '@/lib/resultConflictRepair'
import { prepareAutomaticStageOwnership } from '@/lib/stageOwnershipRepair'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import type { PersistedSnapshot } from '@/storage/types'
import { commitDataOrganization, prepareDataOrganization, type DataOrganizationRequest } from '@/lib/dataOrganization'
import { getStorage } from '@/storage/provider'
import { getJournalBridge } from '@/storage/runtime'
import { flushStorageBeforeCutover, haltPersistAfterCutover, isStorageCutoverInteractionLocked, lockStorageCutoverInteraction } from '@/storage/cutover'
import { pickPersisted } from '@/storage/snapshotProjection'
import { storageDocumentSignal, suspendPersist } from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { replaceLibraryInStore } from '@/lib/snapshotStore'
import { clearReviewSessionFilters, clearReviewSessionStorage } from '@/lib/reviewSession'

export function captureOrganizationSnapshot() {
  return pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
}

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
export async function repairLibraryResults(expected: string, ids: readonly string[], libraryId: string) {
  return commitLibraryOrganization(expected, before => prepareResultConflictRepair(before, ids), libraryId)
}
async function commitLibraryOrganization(expected: string, makeCandidate: (before: PersistedSnapshot) => PersistedSnapshot, expectedLibraryId: string) {
  if (isStorageCutoverInteractionLocked()) throw new Error('已有资料库操作正在执行，请稍后重试。')
  const bridge = getJournalBridge()
  if (!bridge) throw new Error('数据整理仅支持 Windows / macOS 客户端。')
  const storage = getStorage()
  const signal = storageDocumentSignal
  async function checkLibrary() {
    const manifest = await storage.getManifest()
    signal.throwIfAborted()
    if (manifest.libraryId !== expectedLibraryId) throw new Error('资料库已变化，请重新预览。')
  }
  return commitDataOrganization(expected, makeCandidate, {
    signal,
    lock: () => lockStorageCutoverInteraction(signal),
    flush: async () => {
      await checkLibrary()
      await flushStorageBeforeCutover()
    },
    capture: captureOrganizationSnapshot,
    suspend: () => {
      const pause = suspendPersist()
      return outcome => {
        if (signal.aborted) pause.resume({ flushNow: false })
        else if (outcome === 'published') pause.discardAndResume()
        else if (outcome === 'uncertain') {
          haltPersistAfterCutover(pause, '数据整理提交未能安全完成，已停止自动保存。请重新打开资料库确认状态，必要时从整理前备份恢复。', 'reopen')
        } else pause.resume()
      }
    },
    backup: async () => {
      await checkLibrary()
      signal.throwIfAborted()
      const backup = await bridge.createVerifiedBackup()
      signal.throwIfAborted()
      if (!backup) throw new Error('整理前备份未创建，已取消操作。')
      if (backup.status !== 'verified') throw new Error(backup.error ?? '整理前备份校验失败，已取消操作。')
      return backup.path
    },
    persist: snapshot => storage.commitImport(snapshot, [], { pruneUnreferenced: false }),
    publish: snapshot => {
      replaceLibraryInStore(snapshot)
      clearReviewSessionStorage(expectedLibraryId)
      clearReviewSessionFilters(expectedLibraryId)
    },
  })
}

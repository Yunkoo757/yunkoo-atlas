import type { LibrarySwitchMode } from '@/types/journalBridge'
import { replaceLibraryInStore } from '@/lib/snapshotStore'
import { haltPersistAfterCutover, lockStorageCutoverInteraction } from '@/storage/cutover'
import { getElectronAdapter } from '@/storage/electronAdapter'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'
import { flushPersistNow, storageDocumentSignal, suspendPersist } from '@/storage/persist'
import { getJournalBridge } from '@/storage/runtime'
import {
  capturePersistedStateRevision,
  hasSamePersistedStateRevision,
  type PersistedStateRevision,
} from '@/store/persistedRevision'

async function flushCurrentLibraryAtStableRevision(): Promise<PersistedStateRevision> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await waitForPendingStorageOperations()
    storageDocumentSignal.throwIfAborted()
    const before = capturePersistedStateRevision()
    await flushPersistNow()
    const after = capturePersistedStateRevision()
    if (hasSamePersistedStateRevision(before, after)) return after
  }
  throw new Error('切换期间内容持续变化，请停止编辑后重试')
}

type SwitchResult = { ok: true; path: string } | { ok: false; error: string }

/** 只切换已选好的目录。旧库先保存，原子激活回执携带目标快照和写入资格。 */
export async function switchActiveLibrary(mode: LibrarySwitchMode, path: string): Promise<SwitchResult> {
  const bridge = getJournalBridge()
  if (!bridge) return { ok: false, error: '仅桌面端支持切换库目录' }

  const previousPath = await bridge.getLibraryPath()
  let prepared: Awaited<ReturnType<typeof bridge.prepareLibrarySwitch>>
  try {
    storageDocumentSignal.throwIfAborted()
    prepared = await bridge.prepareLibrarySwitch(path, mode)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '候选交易库准备失败',
    }
  }
  if (!prepared.ok) {
    return { ok: false, error: prepared.error ?? '候选交易库准备失败' }
  }

  let cancellation: Promise<boolean> | undefined
  const token = prepared.token
  const cancel = () => cancellation ??= bridge.cancelPreparedLibrary(token).catch(() => false)
  const interrupted: SwitchResult = { ok: false, error: '资料库需要重新打开，切换已中断' }
  if (storageDocumentSignal.aborted) {
    await cancel()
    return interrupted
  }

  const unlockInteraction = lockStorageCutoverInteraction()
  const pause = suspendPersist()
  const interrupt = () => {
    void cancel()
    pause.resume({ flushNow: false })
    unlockInteraction()
  }
  storageDocumentSignal.addEventListener('abort', interrupt, { once: true })

  const sourceIsCurrent = () => bridge.getLibraryPath().then(activePath => activePath === previousPath, () => false)
  let safeToFlush = false
  let candidateActivated = false
  try {
    const stableRevision = await flushCurrentLibraryAtStableRevision()
    storageDocumentSignal.throwIfAborted()
    const result = await bridge.activatePreparedLibrary(token)
    candidateActivated = result.ok
    if (storageDocumentSignal.aborted) return interrupted
    if (!result.ok) {
      safeToFlush = !result.requiresReload && await sourceIsCurrent()
      const message = result.error || '切换库失败'
      return {
        ok: false,
        error: safeToFlush
          ? message
          : `${message}；交易库状态已变化，为保护数据已暂停自动保存，请重新启动应用`,
      }
    }

    if (!hasSamePersistedStateRevision(stableRevision, capturePersistedStateRevision())) {
      throw new Error('切库激活期间内容发生变化')
    }
    getElectronAdapter().clearObjectUrlCache()

    replaceLibraryInStore(result.snapshot)

    safeToFlush = true
    return { ok: true, path: await bridge.getLibraryPath() }
  } catch (err) {
    if (storageDocumentSignal.aborted) return interrupted
    safeToFlush = !candidateActivated && await sourceIsCurrent()
    return {
      ok: false,
      error: safeToFlush
        ? (err instanceof Error ? err.message : '切换库时发生错误')
        : '新交易库载入失败；为保护数据已暂停自动保存，请重新启动应用',
    }
  } finally {
    if (!candidateActivated) await cancel()
    storageDocumentSignal.removeEventListener('abort', interrupt)
    unlockInteraction()
    if (storageDocumentSignal.aborted) {
      pause.resume({ flushNow: false })
    } else if (safeToFlush) {
      await pause.resumeAndFlush()
    } else {
      haltPersistAfterCutover(pause, '新交易库载入失败，自动保存已暂停', 'reload')
    }
  }
}

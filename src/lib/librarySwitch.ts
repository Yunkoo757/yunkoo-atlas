import type { LibrarySwitchMode } from '@/types/journalBridge'
import { replaceLibraryInStore } from '@/lib/snapshotStore'
import { haltPersistAfterCutover, lockStorageCutoverInteraction } from '@/storage/cutover'
import { getElectronAdapter } from '@/storage/electronAdapter'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'
import { flushPersistNow, suspendPersist } from '@/storage/persist'
import { getJournalBridge } from '@/storage/runtime'
import {
  capturePersistedStateRevision,
  hasSamePersistedStateRevision,
  type PersistedStateRevision,
} from '@/store/persistedRevision'

async function flushCurrentLibraryAtStableRevision(): Promise<PersistedStateRevision> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await waitForPendingStorageOperations()
    const before = capturePersistedStateRevision()
    await flushPersistNow()
    const after = capturePersistedStateRevision()
    if (hasSamePersistedStateRevision(before, after)) return after
  }
  throw new Error('切换期间内容持续变化，请停止编辑后重试')
}

/**
 * 设置内切换活跃库：先保存当前库，再打开/新建目录，最后重载快照到 store。
 * 挂起 persist，避免切换瞬间把旧内存写入新路径。
 * @param libPath 已选目录；省略则弹出系统文件夹选择器。
 */
export async function switchActiveLibrary(
  mode: LibrarySwitchMode,
  libPath?: string,
): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> {
  const bridge = getJournalBridge()
  if (!bridge) return { ok: false, error: '仅桌面端支持切换库目录' }

  const picked = libPath ?? (await bridge.pickLibraryFolder())
  if (!picked) return { ok: false, canceled: true }

  const previousPath = await bridge.getLibraryPath()
  let prepared: Awaited<ReturnType<typeof bridge.prepareLibrarySwitch>>
  try {
    prepared = await bridge.prepareLibrarySwitch(picked, mode)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '候选交易库准备失败',
    }
  }
  if (!prepared.ok) {
    return { ok: false, error: prepared.error ?? '候选交易库准备失败' }
  }

  const unlockInteraction = lockStorageCutoverInteraction()
  const pause = suspendPersist()
  let safeToFlush = false
  let candidateActivated = false
  try {
    const stableRevision = await flushCurrentLibraryAtStableRevision()
    const result = await bridge.activatePreparedLibrary(prepared.token)
    if (!result.ok) {
      safeToFlush = !result.requiresReload && await bridge.getLibraryPath().then(
        (activePath) => activePath === previousPath,
        () => false,
      )
      const message =
        mode === 'open' && 'error' in result && typeof result.error === 'string' && result.error
          ? result.error
          : '切换库失败'
      return {
        ok: false,
        error: safeToFlush
          ? message
          : `${message}；交易库状态已变化，为保护数据已暂停自动保存，请重新启动应用`,
      }
    }

    candidateActivated = true
    if (!hasSamePersistedStateRevision(stableRevision, capturePersistedStateRevision())) {
      throw new Error('切库激活期间内容发生变化')
    }
    getElectronAdapter().clearObjectUrlCache()

    replaceLibraryInStore(result.snapshot)

    safeToFlush = true
    return { ok: true, path: await bridge.getLibraryPath() }
  } catch (err) {
    safeToFlush = candidateActivated
      ? false
      : await bridge.getLibraryPath().then(
          (activePath) => activePath === previousPath,
          () => false,
        )
    return {
      ok: false,
      error: safeToFlush
        ? (err instanceof Error ? err.message : '切换库时发生错误')
        : '新交易库载入失败；为保护数据已暂停自动保存，请重新启动应用',
    }
  } finally {
    if (!candidateActivated) {
      await bridge.cancelPreparedLibrary(prepared.token).catch(() => false)
    }
    unlockInteraction()
    if (safeToFlush) {
      await pause.resumeAndFlush()
    } else {
      haltPersistAfterCutover(pause, '新交易库载入失败，自动保存已暂停', 'reload')
    }
  }
}

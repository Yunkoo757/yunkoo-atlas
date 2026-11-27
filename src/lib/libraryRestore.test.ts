import { commitPreparedJournalArchive, restoreLibraryBackup, BackupRestoreFlushError } from '@/lib/libraryRestore'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { isStorageCutoverInteractionLocked } from '@/storage/cutover'
import { disablePersistWrites, enablePersistWrites, flushPersistNow, getPersistSuspendDepth } from '@/storage/persist'
import { useSaveStatus } from '@/store/saveStatus'
import type { JournalBridge } from '@/types/journalBridge'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function withDesktopRestore(
  bridge: Partial<JournalBridge>,
  run: (events: { writes: number; reloads: number; recoveryNotices: number }) => Promise<void>,
): Promise<void> {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousStatus = useSaveStatus.getState()
  const previousStore = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const events = { writes: 0, reloads: 0, recoveryNotices: 0 }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    journalBridge: { isElectron: true, saveSnapshot: async () => { events.writes++ }, ...bridge },
    location: { reload: () => { events.reloads++ } },
    dispatchEvent: () => { events.recoveryNotices++; return true },
  } })
  enablePersistWrites()
  try {
    await run(events)
  } finally {
    disablePersistWrites()
    useSaveStatus.setState(previousStatus, true)
    useStore.setState(previousStore, true)
    useShortcutStore.setState(previousShortcuts, true)
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testUnknownDesktopReplacementCannotWriteStaleMemoryWhenStatusResetThrows(): Promise<void> {
  await withDesktopRestore({
    commitPreparedJournalImport: async () => { throw new Error('IPC reply lost') },
  }, async events => {
    useSaveStatus.setState({ reset: () => { throw new Error('observer unavailable') } })
    await commitPreparedJournalArchive('synthetic').catch(() => {})
    assert(getPersistSuspendDepth() === 0 && !isStorageCutoverInteractionLocked(), '恢复失败必须归还暂停并解除界面锁')
    const before = events.writes
    await flushPersistNow()
    assert(events.writes === before && before === 1, '替换状态不明时后续自动保存不得写回旧资料')
    assert(events.reloads === 1, '保存状态订阅者异常仍需触发归档恢复')
  })
}

export async function testDefinitivelyUncommittedArchiveResumesOldLibrary(): Promise<void> {
  await withDesktopRestore({
    commitPreparedJournalImport: async () => {
      assert(isStorageCutoverInteractionLocked() && getPersistSuspendDepth() === 1, '桌面替换必须持有界面与写盘保护')
      return { ok: false, committed: false, code: 'SOURCE_CHANGED' }
    },
  }, async events => {
    const result = await commitPreparedJournalArchive('synthetic')
    assert(!result.ok && result.code === 'SOURCE_CHANGED', '保留旧预览失效的错误码')
    assert(events.writes === 2 && events.reloads === 0, '确认未落盘时应继续保存原库')
    assert(getPersistSuspendDepth() === 0 && !isStorageCutoverInteractionLocked(), '冲突后不得保留锁')
  })
}

export async function testBackupFailureWithUnknownCommitNotifiesRecoveryEvenIfSaveStatusFails(): Promise<void> {
  await withDesktopRestore({
    restoreBackup: async () => { throw new Error('lost backup reply') },
  }, async events => {
    useSaveStatus.setState({ setError: () => { throw new Error('status listener failed') } })
    let published = false
    await restoreLibraryBackup('synthetic', async () => { published = true }).catch(() => {})
    await flushPersistNow()
    assert(!published && events.writes === 1, '未知的备份替换不能发布或再写原快照')
    assert(events.recoveryNotices === 1 && events.reloads === 0, '备份失败必须派发恢复页事件')
    assert(getPersistSuspendDepth() === 0 && !isStorageCutoverInteractionLocked(), '错误通知异常仍须解除交互锁')
  })
}

export async function testBackupPublishesBeforeRefreshAndReportsTrailingSaveFailure(): Promise<void> {
  const snapshot = createFullPersistedSnapshotFixture()
  let writeCount = 0
  let refreshed = false
  await withDesktopRestore({
    getManifest: async () => ({ schemaVersion: 12, libraryId: 'isolated', createdAt: '2026-01-01' }),
    restoreBackup: async () => ({ ok: true, committed: true, snapshot }),
    saveSnapshot: async () => {
      if (++writeCount === 2) throw new Error('trailing disk failure')
      return true
    },
  }, async events => {
    let error: unknown
    try {
      await restoreLibraryBackup('synthetic', async () => {
        assert(isStorageCutoverInteractionLocked() && getPersistSuspendDepth() === 1, '刷新前不得开放交互或自动保存')
        assert(useStore.getState().trades[0]?.id === snapshot.trades[0]?.id, '刷新必须看到已恢复的交易')
        refreshed = true
      })
    } catch (failure) { error = failure }
    assert(refreshed && writeCount === 2 && error instanceof BackupRestoreFlushError, '备份已载入但尾随保存失败时必须单独提示')
    assert(!events.reloads && !events.recoveryNotices, '已发布的内存快照应继续允许保存重试')
    assert(getPersistSuspendDepth() === 0 && !isStorageCutoverInteractionLocked(), '显示保存错误前必须释放锁')
  })
}

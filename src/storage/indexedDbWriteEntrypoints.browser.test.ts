import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import {
  IndexedDbStorageAdapter,
  StorageRevisionConflictError,
} from '@/storage/indexedDbAdapter'
import type { PersistedSnapshot } from '@/storage/types'
import { clearWebOperationLogsForTests, getWebOperationLogs } from '@/storage/webOperationLogger'

declare global {
  interface Window {
    __indexedDbWriteEntrypointsTest?: Promise<void>
  }
}

const DB_NAME = 'linear-journal-v3'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshot(name: string, assetIds: readonly string[] = []): PersistedSnapshot {
  return {
    trades: [],
    quickNotes: assetIds.length > 0 ? [{
      id: `note-${name}`,
      title: name,
      contentHtml: assetIds.map((id) => `<img src="journal-asset://${id}">`).join(''),
      pinned: false,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    }] : [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY },
    profile: { avatarId: null, displayName: name },
  }
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('测试数据库仍被占用'))
  })
}

async function run(): Promise<void> {
  await deleteDatabase()
  const writer = new IndexedDbStorageAdapter()
  const observer = new IndexedDbStorageAdapter()
  await writer.open()
  await observer.open()
  assert((await writer.loadSnapshotEnvelope()).revision === 0, '新库必须从 revision 0 开始')

  await writer.saveSnapshot(snapshot('autosave'))
  let observed = await observer.loadSnapshotEnvelope()
  assert(observed.revision === 1, 'saveSnapshot 必须走 CAS 并推进 revision')
  assert(observed.snapshot?.profile?.displayName === 'autosave', 'saveSnapshot 必须提交候选快照')

  const stagedId = await writer.saveAsset(new Blob(['staged'], { type: 'image/png' }), 'image/png')
  assert((await observer.getAssetForExport(stagedId)) === null, 'saveAsset 只能暂存，不能先于引用快照落盘')
  assert(await writer.getSnapshotRevision() === 1, '暂存附件不得单独推进 revision')
  await writer.saveSnapshot(snapshot('attachment', [stagedId]))
  observed = await observer.loadSnapshotEnvelope()
  assert(observed.revision === 2, '附件必须随引用快照在同一 mutation 中提交')
  assert(await observer.getAssetForExport(stagedId), '引用快照确认后附件必须可被其他 adapter 读取')

  const migratedId = 'migration-staged-asset'
  await writer.importAssets([{
    id: migratedId,
    mime: 'image/png',
    data: btoa('migration'),
  }])
  assert((await observer.getAssetForExport(migratedId)) === null, 'importAssets 只能准备 migration 附件')
  await writer.saveSnapshot(snapshot('migration', [stagedId, migratedId]))
  observed = await observer.loadSnapshotEnvelope()
  assert(observed.revision === 3, 'migration snapshot 与准备附件必须单次提交')
  assert(await observer.getAssetForExport(migratedId), 'migration CAS 成功后附件必须持久化')

  const importedId = 'atomic-import-asset'
  clearWebOperationLogsForTests()
  await writer.commitImport(snapshot('import', [importedId]), [{
    id: importedId,
    mime: 'image/png',
    data: btoa('import'),
  }])
  observed = await observer.loadSnapshotEnvelope()
  assert(observed.revision === 4, 'commitImport 必须通过单一 mutation 推进 revision')
  const successfulImportLogs = getWebOperationLogs().filter((record) => record.event.startsWith('import:'))
  assert(successfulImportLogs.map((record) => record.event).join(',') === 'import:start,import:success', 'Web import 成功必须只记录 start→success')
  assert(await observer.getAssetForExport(importedId), 'commitImport 必须原子提交附件')

  const restoredId = 'atomic-restore-asset'
  await writer.replaceArchive(snapshot('restore', [restoredId]), [{
    id: restoredId,
    mime: 'image/png',
    data: btoa('restore'),
  }])
  observed = await observer.loadSnapshotEnvelope()
  assert(observed.revision === 5, 'replaceArchive 必须通过 replace mutation 推进 revision')
  assert(observed.snapshot?.profile?.displayName === 'restore', 'replaceArchive 必须替换快照')
  assert(await observer.getAssetForExport(restoredId), 'replaceArchive 必须写入恢复附件')
  assert((await observer.getAssetForExport(importedId)) === null, 'replaceArchive 必须在同一事务清除旧附件')

  const stalePreparedId = await observer.saveAsset(
    new Blob(['stale-prepared'], { type: 'image/png' }),
    'image/png',
  )
  await writer.saveSnapshot(snapshot('autosave-winner', [restoredId]))
  let conflict: unknown
  try {
    await observer.saveSnapshot(snapshot('autosave-stale', [restoredId, stalePreparedId]))
  } catch (error) {
    conflict = error
  }
  assert(conflict instanceof StorageRevisionConflictError, 'stale autosave 必须暴露 typed conflict')
  observed = await writer.loadSnapshotEnvelope()
  assert(observed.revision === 6, 'stale autosave 不得推进赢家 revision')
  assert(observed.snapshot?.profile?.displayName === 'autosave-winner', 'stale autosave 不得覆盖赢家快照')
  assert((await writer.getAssetForExport(stalePreparedId)) === null, 'stale autosave 不得部分写入准备附件')
  assert(await observer.getAssetForExport(stalePreparedId), '冲突后必须保留本标签页准备附件供恢复导出')

  const staleImport = new IndexedDbStorageAdapter()
  await staleImport.open()
  assert((await staleImport.loadSnapshotEnvelope()).revision === 6, 'import 竞态双方必须从同一 revision 开始')
  await writer.saveSnapshot(snapshot('import-race-winner', [restoredId]))
  const staleImportId = 'stale-import-asset'
  conflict = undefined
  clearWebOperationLogsForTests()
  try {
    await staleImport.commitImport(snapshot('stale-import', [staleImportId]), [{
      id: staleImportId,
      mime: 'image/png',
      data: btoa('stale-import'),
    }])
  } catch (error) {
    conflict = error
  }
  assert(conflict instanceof StorageRevisionConflictError, 'stale import 必须暴露 typed conflict')
  const failedImportLogs = getWebOperationLogs().filter((record) => record.event.startsWith('import:'))
  assert(failedImportLogs.map((record) => record.event).join(',') === 'import:start,import:failure', 'Web import 冲突必须只记录 start→failure')
  assert(!JSON.stringify(failedImportLogs).includes('success'), 'Web import 冲突不得误报 success')
  observed = await writer.loadSnapshotEnvelope()
  assert(observed.revision === 7, 'stale import 不得推进 revision')
  assert(observed.snapshot?.profile?.displayName === 'import-race-winner', 'stale import 不得覆盖赢家快照')
  assert((await writer.getAssetForExport(staleImportId)) === null, 'stale import 不得部分写入附件')

  const staleRestore = new IndexedDbStorageAdapter()
  await staleRestore.open()
  assert((await staleRestore.loadSnapshotEnvelope()).revision === 7, 'restore 竞态双方必须从同一 revision 开始')
  await writer.saveSnapshot(snapshot('restore-race-winner', [restoredId]))
  const staleRestoreId = 'stale-restore-asset'
  conflict = undefined
  try {
    await staleRestore.replaceArchive(snapshot('stale-restore', [staleRestoreId]), [{
      id: staleRestoreId,
      mime: 'image/png',
      data: btoa('stale-restore'),
    }])
  } catch (error) {
    conflict = error
  }
  assert(conflict instanceof StorageRevisionConflictError, 'stale restore 必须暴露 typed conflict')
  observed = await writer.loadSnapshotEnvelope()
  assert(observed.revision === 8, 'stale restore 不得推进 revision')
  assert(observed.snapshot?.profile?.displayName === 'restore-race-winner', 'stale restore 不得覆盖赢家快照')
  assert(await writer.getAssetForExport(restoredId), 'stale restore 不得清除赢家附件')
  assert((await writer.getAssetForExport(staleRestoreId)) === null, 'stale restore 不得写入候选附件')
}

window.__indexedDbWriteEntrypointsTest = run()

import {
  IndexedDbStorageAdapter,
  StorageRevisionConflictError,
} from '@/storage/indexedDbAdapter'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import type { PersistedSnapshot } from '@/storage/types'
import { buildWebJournalArchiveBlob } from '@/lib/importExport'
import { parseWebJournalArchive } from '@/lib/webJournalArchive'

declare global {
  interface Window {
    __indexedDbAssetGcTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshot(liveId: string): PersistedSnapshot {
  return createFullPersistedSnapshotFixture({
    trade: liveId,
    weeklyReview: liveId,
    quickNote: liveId,
    shared: liveId,
  })
}

function seedRawAsset(databaseName: string, id: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('assets', 'readwrite')
      const blob = new Blob([body], { type: 'image/png' })
      tx.objectStore('assets').put({
        id, mime: 'image/png', byteSize: blob.size,
        createdAt: new Date().toISOString(), blob,
      })
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

function deleteDatabase(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function createFixture(databaseName: string): Promise<{
  storage: IndexedDbStorageAdapter
  liveId: string
}> {
  const storage = new IndexedDbStorageAdapter(databaseName, { assetPurgeCommitEnabled: true })
  await storage.open()
  const liveId = await storage.saveAsset(new Blob(['shared-live']), 'image/png')
  await storage.saveSnapshot(snapshot(liveId))
  await seedRawAsset(databaseName, 'orphan-a', 'orphan-a')
  await seedRawAsset(databaseName, 'orphan-b', 'orphan-b')
  return { storage, liveId }
}

async function testDefaultKillSwitchAndRecoveryAuthorizationAreEnforced(): Promise<void> {
  const databaseName = `asset-gc-policy-${crypto.randomUUID()}`
  const storage = new IndexedDbStorageAdapter(databaseName)
  await storage.open()
  const liveId = await storage.saveAsset(new Blob(['shared-live']), 'image/png')
  await storage.saveSnapshot(snapshot(liveId))
  await seedRawAsset(databaseName, 'orphan-a', 'orphan-a')
  try {
    const preview = await storage.previewAssetPurge()
    const recovery = await storage.prepareAssetPurgeRecovery(preview)
    const before = await fingerprint(storage)
    let rejected = false
    try { await storage.commitAssetPurge(preview, recovery.authorization) } catch { rejected = true }
    assert(rejected, '默认 Release 3 kill switch 必须在 adapter 边界拒绝直接永久删除')
    assert(await fingerprint(storage) === before, '边界开关拒绝必须零删除')
  } finally {
    storage.close()
    await deleteDatabase(databaseName)
  }
}

async function fingerprint(storage: IndexedDbStorageAdapter): Promise<string> {
  const envelope = await storage.loadSnapshotEnvelope()
  return JSON.stringify({
    revision: envelope.revision,
    snapshot: envelope.snapshot,
    orphanA: await storage.getAssetForExport('orphan-a'),
    orphanB: await storage.getAssetForExport('orphan-b'),
  })
}

async function testStalePreviewDeletesNothing(): Promise<void> {
  const databaseName = `asset-gc-stale-${crypto.randomUUID()}`
  const { storage, liveId } = await createFixture(databaseName)
  const winner = new IndexedDbStorageAdapter(databaseName)
  await winner.open()
  try {
    const preview = await storage.previewAssetPurge()
    const recovery = await storage.prepareAssetPurgeRecovery(preview)
    assert(preview.candidateIds.join(',') === 'orphan-a,orphan-b', '预览只能包含当前健康 orphan')
    await winner.commitLibraryMutation({
      expectedRevision: preview.revision,
      snapshot: snapshot(liveId),
      reason: 'autosave',
    })
    const before = await fingerprint(storage)
    let error: unknown
    try { await storage.commitAssetPurge(preview, recovery.authorization) } catch (caught) { error = caught }
    assert(error instanceof StorageRevisionConflictError, '过期预览必须返回 typed revision conflict')
    assert(await fingerprint(storage) === before, '过期预览必须零删除且不改变当前 revision/snapshot')
  } finally {
    storage.close()
    winner.close()
    await deleteDatabase(databaseName)
  }
}

async function testDeleteFailureRollsBackAndSuccessRevokesCache(): Promise<void> {
  const databaseName = `asset-gc-atomic-${crypto.randomUUID()}`
  const { storage, liveId } = await createFixture(databaseName)
  try {
    await storage.getAssetObjectUrl('orphan-a')
    const before = await fingerprint(storage)
    const canceled = await storage.previewAssetPurge()
    const canceledRecovery = await storage.prepareAssetPurgeRecovery(canceled)
    await storage.cancelAssetPurge(canceled.operationId)
    let canceledRejected = false
    try { await storage.commitAssetPurge(canceled, canceledRecovery.authorization) } catch { canceledRejected = true }
    assert(canceledRejected, '取消后旧 preview 与恢复授权必须立即失效')
    assert(await fingerprint(storage) === before, '取消旧授权必须零删除')
    const unauthorized = await storage.previewAssetPurge()
    let unauthorizedRejected = false
    try { await storage.commitAssetPurge(unauthorized, '') } catch { unauthorizedRejected = true }
    assert(unauthorizedRejected, '即使 kill switch 开启，缺少恢复归档授权也必须在删除前拒绝')
    assert(await fingerprint(storage) === before, '缺少归档授权必须零删除')
    for (const mutate of [
      (preview: Awaited<ReturnType<typeof storage.previewAssetPurge>>) => { preview.revision += 1 },
      (preview: Awaited<ReturnType<typeof storage.previewAssetPurge>>) => { preview.candidateIds.pop() },
      (preview: Awaited<ReturnType<typeof storage.previewAssetPurge>>) => { preview.totalBytes = 0 },
    ]) {
      const tampered = await storage.previewAssetPurge()
      const recovery = await storage.prepareAssetPurgeRecovery(tampered)
      mutate(tampered)
      let tamperRejected = false
      try { await storage.commitAssetPurge(tampered, recovery.authorization) } catch { tamperRejected = true }
      assert(tamperRejected, 'revision、候选集合或 totalBytes 被篡改时必须拒绝一次性预览')
      assert(await fingerprint(storage) === before, '预览篡改拒绝后存储必须零变化')
    }
    const failedPreview = await storage.previewAssetPurge()
    const failedRecovery = await storage.prepareAssetPurgeRecovery(failedPreview)
    const originalDelete = IDBObjectStore.prototype.delete
    let deleteCount = 0
    IDBObjectStore.prototype.delete = function failSecondDelete(key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'assets' && ++deleteCount === 2) {
        throw new DOMException('forced second delete failure', 'DataError')
      }
      return originalDelete.call(this, key)
    }
    let rejected = false
    try { await storage.commitAssetPurge(failedPreview, failedRecovery.authorization) } catch { rejected = true } finally {
      IDBObjectStore.prototype.delete = originalDelete
    }
    assert(rejected, '第 N 个 delete 故障必须拒绝整个 purge')
    assert(await fingerprint(storage) === before, 'delete 故障后两个附件、快照与 revision 必须全部回滚')

    const revoked: string[] = []
    let successfulRecovery: Awaited<ReturnType<typeof storage.prepareAssetPurgeRecovery>> | null = null
    const originalRevoke = URL.revokeObjectURL
    URL.revokeObjectURL = (url) => { revoked.push(url); originalRevoke.call(URL, url) }
    try {
      const preview = await storage.previewAssetPurge()
      const recovery = await storage.prepareAssetPurgeRecovery(preview)
      successfulRecovery = recovery
      assert(
        recovery.webArchive?.recoveryOrphanAssetIds.join(',') === 'orphan-a,orphan-b',
        '恢复归档必须显式声明本次将删除的 orphan 候选',
      )
      const purge = storage.commitAssetPurge(preview, recovery.authorization)
      let importRejected = false
      try {
        await storage.importAssets([{
          id: 'orphan-a',
          mime: 'image/png',
          data: btoa('replacement-during-purge'),
        }])
      } catch {
        importRejected = true
      }
      assert(importRejected, 'purge 运行期间同 ID prepared import 必须 fail-closed')
      const result = await purge
      assert(result.revision === preview.revision + 1, '成功清理必须在同一事务推进 revision')
      assert(result.deletedIds.join(',') === 'orphan-a,orphan-b', '成功结果必须精确返回预览候选')
    } finally {
      URL.revokeObjectURL = originalRevoke
    }
    assert(revoked.length === 1, '成功删除已缓存附件时必须失效对应 Object URL')
    assert(await storage.getAssetForExport('orphan-a') === null, 'orphan-a 物理记录必须删除')
    assert(await storage.getAssetForExport('orphan-b') === null, 'orphan-b 物理记录必须删除')
    assert(await storage.getAssetForExport(liveId), '三个富文本域共享的 live 附件必须保留')
    assert((await storage.previewAssetPurge()).candidateIds.length === 0, '成功后再次扫描 orphan 必须为零')

    const recoveryPreview = await storage.previewAssetPurge()
    assert(recoveryPreview.candidateIds.length === 0, '恢复前当前库必须保持已清理状态')
    const archiveBlob = buildWebJournalArchiveBlob(
      successfulRecovery!.webArchive!.snapshot,
      successfulRecovery!.webArchive!.assets,
      { recoveryOrphanAssetIds: successfulRecovery!.webArchive!.recoveryOrphanAssetIds },
    )
    const parsed = await parseWebJournalArchive(archiveBlob)
    await storage.replaceArchive(
      parsed.snapshot,
      parsed.assets,
      parsed.recoveryOrphanAssetIds ?? [],
    )
    const recoveredEnvelope = await storage.loadSnapshotEnvelope()
    assert(
      JSON.stringify(recoveredEnvelope.snapshot) === JSON.stringify(successfulRecovery!.webArchive!.snapshot),
      '恢复归档必须逐字段恢复操作前 snapshot',
    )
    assert(
      recoveredEnvelope.revision === recoveryPreview.revision + 1,
      '恢复归档必须以新的 CAS 提交推进 revision，不能回退或复用旧 revision',
    )
    assert(atob((await storage.getAssetForExport('orphan-a'))!.data) === 'orphan-a', '恢复归档必须逐字节找回 orphan-a')
    assert(atob((await storage.getAssetForExport('orphan-b'))!.data) === 'orphan-b', '恢复归档必须逐字节找回 orphan-b')
  } finally {
    storage.close()
    await deleteDatabase(databaseName)
  }
}

async function run(): Promise<void> {
  await testDefaultKillSwitchAndRecoveryAuthorizationAreEnforced()
  await testStalePreviewDeletesNothing()
  await testDeleteFailureRollsBackAndSuccessRevokesCache()
}

window.__indexedDbAssetGcTest = run()

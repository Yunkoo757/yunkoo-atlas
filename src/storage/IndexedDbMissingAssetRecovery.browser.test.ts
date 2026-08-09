import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { OperationalError } from '@/lib/operationalError'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import type { PersistedSnapshot } from '@/storage/types'

declare global {
  interface Window {
    __indexedDbMissingAssetRecoveryTest?: Promise<void>
  }
}

const DB_NAME = 'trader-atlas-v3'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshot(name: string, assetIds: readonly string[]): PersistedSnapshot {
  return {
    ...createEmptyPersistedSnapshot(),
    quickNotes: assetIds.length > 0 ? [{
      id: 'missing-asset-note',
      title: '缺附件恢复测试',
      contentHtml: assetIds.map((id) => `<img src="journal-asset://${id}">`).join(''),
      pinned: false,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    }] : [],
    display: { ...DEFAULT_DISPLAY },
    profile: { avatarId: null, displayName: name, legacyCashCurrencyAssumption: null },
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

async function deleteStoredAsset(id: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('assets', 'readwrite')
      tx.objectStore('assets').delete(id)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

async function expectMissingAssetRejection(operation: Promise<unknown>, message: string): Promise<void> {
  let error: unknown
  try {
    await operation
  } catch (caught) {
    error = caught
  }
  assert(error instanceof OperationalError && error.code === 'asset-reference-missing', message)
}

async function run(): Promise<void> {
  await deleteDatabase()
  const adapter = new IndexedDbStorageAdapter()
  await adapter.open()
  try {
    const historicalId = await adapter.saveAsset(new Blob(['historical'], { type: 'image/png' }), 'image/png')
    await adapter.saveSnapshot(snapshot('初始快照', [historicalId]))
    await deleteStoredAsset(historicalId)

    await adapter.saveSnapshot(snapshot('缺附件后仍可编辑', [historicalId]))
    let envelope = await adapter.loadSnapshotEnvelope()
    assert(envelope.revision === 2, '历史附件丢失后，无关编辑仍应推进 revision')
    assert(envelope.snapshot?.profile?.displayName === '缺附件后仍可编辑', '降级提交必须保留用户编辑')

    await expectMissingAssetRejection(
      adapter.saveSnapshot(snapshot('不得新增缺附件', [historicalId, 'new-missing-asset'])),
      '新引入的缺附件引用必须继续 fail-closed',
    )
    assert(await adapter.getSnapshotRevision() === 2, '拒绝新增缺附件后 revision 必须不变')

    await adapter.saveSnapshot(snapshot('显式移除缺失引用', []))
    envelope = await adapter.loadSnapshotEnvelope()
    assert(envelope.revision === 3, '移除缺失引用应作为显式修复提交')

    await expectMissingAssetRejection(
      adapter.saveSnapshot(snapshot('不得重新引入旧缺附件', [historicalId])),
      '显式修复后不得重新引入已经移除的缺附件引用',
    )
  } finally {
    adapter.close()
    await deleteDatabase()
  }
}

window.__indexedDbMissingAssetRecoveryTest = run()

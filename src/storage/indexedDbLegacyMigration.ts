import type { PersistedSnapshot } from '@/storage/types'
import {
  queueIndexedDbSnapshotAssetWrites,
  type IndexedDbAssetRecord,
} from '@/storage/indexedDbSnapshotAssetWrites'

/** 仅供同事务 schema 升级使用；不负责 revision/CAS，也不能作为业务写入口。 */
export function queueIndexedDbLegacySnapshotUpgrade(
  snapshotStore: IDBObjectStore,
  assetStore: IDBObjectStore,
  snapshot: PersistedSnapshot,
): void {
  queueIndexedDbSnapshotAssetWrites(snapshotStore, assetStore, {
    snapshot,
    assetMode: 'merge',
    assetPuts: [] satisfies IndexedDbAssetRecord[],
  })
}

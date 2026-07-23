export interface IndexedDbAssetRecord {
  id: string
  mime: string
  byteSize: number
  createdAt: string
  blob: Blob
}

export interface IndexedDbSnapshotAssetWrite {
  snapshot: unknown
  assetMode: 'merge' | 'replace'
  assetPuts?: readonly IndexedDbAssetRecord[]
  assetDeletes?: readonly string[]
}

/**
 * Queues snapshot and asset writes without revision semantics.
 * Release 0 uses only this boundary; Release 1 adds revision/CAS in its caller's transaction.
 */
export function queueIndexedDbSnapshotAssetWrites(
  snapshotStore: IDBObjectStore,
  assetStore: IDBObjectStore,
  input: IndexedDbSnapshotAssetWrite,
): void {
  snapshotStore.put(input.snapshot, 'main')
  if (input.assetMode === 'replace') assetStore.clear()
  for (const record of input.assetPuts ?? []) assetStore.put(record)
  for (const id of input.assetDeletes ?? []) assetStore.delete(id)
}

import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'

export interface AssetStorageStats {
  count: number
  totalBytes: number
  missingCount: number
}

export type PhysicalAssetState = 'healthy' | 'missing' | 'size-mismatch' | 'foreign' | 'temp'

export interface PhysicalAssetRecord {
  id: string
  mime?: string
  declaredBytes?: number
  actualBytes?: number
  state: PhysicalAssetState
  source: 'committed' | 'prepared' | 'filesystem'
}

export interface AssetPurgePreview {
  operationId: string
  revision: number
  candidateIds: string[]
  totalBytes: number
}

export interface AssetPurgeResult {
  revision: number
  deletedIds: string[]
}

export interface AssetPurgeRecovery {
  authorization: string
  webArchive?: {
    snapshot: PersistedSnapshot
    assets: ExportAssetRecord[]
    recoveryOrphanAssetIds: string[]
  }
  path?: string
}

export interface StorageAdapter {
  open(): Promise<void>
  getManifest(): Promise<LibraryManifest>

  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<void>

  saveAsset(blob: Blob, mime: string): Promise<string>
  getAssetObjectUrl(id: string): Promise<string | null>
  getAssetForExport(id: string): Promise<ExportAssetRecord | null>
  getAssetStats(ids: string[]): Promise<AssetStorageStats>
  listAssetRecords?(): Promise<PhysicalAssetRecord[]>
  previewAssetPurge?(): Promise<AssetPurgePreview>
  prepareAssetPurgeRecovery?(preview: AssetPurgePreview): Promise<AssetPurgeRecovery>
  cancelAssetPurge?(operationId: string): Promise<void>
  commitAssetPurge?(preview: AssetPurgePreview, authorization: string): Promise<AssetPurgeResult>
  importAssets(assets: ExportAssetRecord[]): Promise<void>
  commitImport(
    snapshot: PersistedSnapshot,
    assets: ExportAssetRecord[],
    options?: { pruneUnreferenced?: boolean },
  ): Promise<void>
}

export interface SnapshotEnvelope {
  revision: number
  snapshot: PersistedSnapshot | null
}

export interface PreparedAssetPut {
  id: string
  mime: string
  blob: Blob
}

export interface RevisionedLibraryMutation {
  expectedRevision: number
  snapshot: PersistedSnapshot
  assetPuts?: readonly PreparedAssetPut[]
  assetDeletes?: readonly string[]
  assetMode?: 'merge' | 'replace'
  allowedUnreferencedAssetPuts?: readonly string[]
  reason: 'autosave' | 'import' | 'restore' | 'migration' | 'purge' | 'attachment'
}

export interface RevisionedStorageAdapter extends StorageAdapter {
  loadSnapshotEnvelope(): Promise<SnapshotEnvelope>
  commitLibraryMutation(input: RevisionedLibraryMutation): Promise<{ revision: number }>
}

export class StorageRevisionConflictError extends Error {
  readonly code = 'storage-revision-conflict'

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Storage revision conflict: expected ${expectedRevision}, actual ${actualRevision}`)
    this.name = 'StorageRevisionConflictError'
  }
}

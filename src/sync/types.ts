export type SyncEntityType = 'trade' | 'strategy' | 'workspace'

export type SyncOperationKind = 'upsert' | 'delete'

export interface SnapshotMutation {
  entityType: SyncEntityType
  entityId: string
  kind: SyncOperationKind
  payload: unknown | null
}

export interface SyncOutboxOperation extends SnapshotMutation {
  opId: string
  deviceId: string
  deviceSeq: number
  baseRevision: number
  revision: number
  createdAt: string
  state: 'pending'
}

export interface RemoteSyncOperation extends SyncOutboxOperation {
  cursor: string
}

export interface LocalSyncStatus {
  libraryId: string
  deviceId: string
  epoch: number
  deviceSeq: number
  pullCursor: string | null
  lastSyncAt: string | null
  pendingCount: number
  conflictCount: number
}

export interface SyncConflict {
  conflictId: string
  entityType: SyncEntityType
  entityId: string
  localRevision: number
  remoteOperation: RemoteSyncOperation
  createdAt: string
  state: 'unresolved'
}

export interface RemoteSyncApplyResult {
  appliedCount: number
  conflictCount: number
  appliedOperations?: RemoteSyncOperation[]
}

export interface SyncEntityVersionUpdate {
  entityType: SyncEntityType
  entityId: string
  revision: number
  deleted: boolean
  updatedAt: string
}

export interface LocalSyncBatch {
  deviceSeq: number
  operations: SyncOutboxOperation[]
  versions: SyncEntityVersionUpdate[]
}

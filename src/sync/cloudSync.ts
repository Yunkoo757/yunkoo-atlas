export type CloudSyncPhase = 'disabled' | 'idle' | 'syncing' | 'offline' | 'error'

export interface CloudSyncConfig {
  enabled: boolean
  baseUrl: string
  libraryId: string
  hasToken: boolean
}

export interface CloudSyncState extends CloudSyncConfig {
  phase: CloudSyncPhase
  lastSyncAt: string | null
  pendingCount: number
  conflictCount: number
  assetCount: number
  missingAssetCount: number
  message: string | null
}

export interface CloudSyncExecution {
  state: CloudSyncState
  appliedOperations: import('@/sync/types').RemoteSyncOperation[]
  authoritativeSnapshot?: import('@/storage/types').PersistedSnapshot
}

export interface SaveCloudSyncConfigInput {
  baseUrl: string
  libraryId: string
  token?: string
}

export type CloudSyncSetupMode = 'create' | 'connect' | 'replace'

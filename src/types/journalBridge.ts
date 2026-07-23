import type { AppUpdateState } from '@/lib/appUpdate'
import type { WindowSizePresetId } from '@/lib/windowBounds'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import type { PhysicalAssetRecord } from '@/storage/adapter'
import type { AssetPurgePreview, AssetPurgeRecovery, AssetPurgeResult } from '@/storage/adapter'

export interface BackupInfo {
  name: string
  timestamp: number
  size: number
  tradeCount?: number
  strategyCount?: number
  attachmentCount?: number
  verification?: BackupVerificationResult
}

export interface BackupVerificationResult {
  status: 'verified' | 'invalid'
  checkedAt: number
  tradeCount?: number
  strategyCount?: number
  attachmentCount?: number
  error?: string
  emptyLibrary?: boolean
}

export type WindowFrameState = {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
  presetId: WindowSizePresetId | null
}

export type LibraryLocationState =
  | { kind: 'unset' }
  | {
      kind: 'ready'
      configuredPath: string
      resolvedPath: string
      source: 'config' | 'environment' | 'default'
    }
  | { kind: 'unavailable'; configuredPath: string; reason: string }
  | { kind: 'invalid'; configuredPath: string; reason: string }
  | { kind: 'needs-recovery'; configuredPath: string; reason: string }

export interface JournalBridge {
  isElectron: true
  onBeforeClose(callback: () => void | Promise<void>): () => void
  onCloseSaveError(callback: (message: string) => void): () => void
  requestClose(): Promise<void>
  toggleFullscreen(): Promise<boolean>
  getLibraryStatus(): Promise<LibraryLocationState>
  pickLibraryFolder(): Promise<string | null>
  createNewLibrary(libPath: string): Promise<
    { ok: true; snapshot: PersistedSnapshot | null } | { ok: false; error?: string }
  >
  openExistingLibrary(libPath: string): Promise<
    { ok: true; snapshot: PersistedSnapshot | null } | { ok: false; error?: string }
  >
  prepareLibrarySwitch(libPath: string, mode: 'create' | 'open'): Promise<
    { ok: true; token: string } | { ok: false; error?: string }
  >
  activatePreparedLibrary(token: string): Promise<
    { ok: true; snapshot: PersistedSnapshot | null } | { ok: false; error?: string }
  >
  cancelPreparedLibrary(token: string): Promise<boolean>
  getLibraryPath(): Promise<string>
  storageOpen(): Promise<boolean>
  getManifest(): Promise<LibraryManifest>
  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<boolean>
  saveAsset(data: ArrayBuffer, mime: string): Promise<string>
  getAssetBytes(id: string): Promise<{ id: string; mime: string; bytes: Uint8Array } | null>
  getAssetStats(ids: string[]): Promise<{ count: number; totalBytes: number; missingCount: number }>
  listAssetRecords(): Promise<PhysicalAssetRecord[]>
  previewAssetPurge(): Promise<AssetPurgePreview>
  prepareAssetPurgeRecovery(preview: AssetPurgePreview): Promise<AssetPurgeRecovery | null>
  cancelAssetPurge(operationId: string): Promise<boolean>
  commitAssetPurge(preview: AssetPurgePreview, authorization: string): Promise<AssetPurgeResult>
  importAssets(assets: ExportAssetRecord[]): Promise<boolean>
  commitImport(
    snapshot: PersistedSnapshot,
    assets: ExportAssetRecord[],
    options?: { pruneUnreferenced?: boolean },
  ): Promise<boolean>
  exportJournalZip(): Promise<{ ok: true; path: string } | { ok: false }>
  importJournalZip(): Promise<
    | { ok: true; snapshot: PersistedSnapshot | null }
    | { ok: false; canceled?: boolean; error?: string }
  >
  createBackup(): Promise<string | null>
  listBackups(): Promise<BackupInfo[]>
  verifyBackup(fileName: string): Promise<BackupVerificationResult>
  restoreBackup(fileName: string): Promise<PersistedSnapshot | null>
  deleteBackup(fileName: string): Promise<boolean>
  getBackupStats(): Promise<{ count: number; totalSize: number }>
  getWindowState(): Promise<WindowFrameState | null>
  applyWindowPreset(
    presetId: WindowSizePresetId,
  ): Promise<{ ok: true; state: WindowFrameState } | { ok: false; error: string }>
  getUpdateState(): Promise<AppUpdateState>
  hasUpdateCredential(): Promise<boolean>
  saveUpdateCredential(token: string): Promise<boolean>
  clearUpdateCredential(): Promise<boolean>
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  installUpdate(): Promise<boolean>
  onUpdateState(callback: (state: AppUpdateState) => void): () => void
}

declare global {
  interface Window {
    journalBridge?: JournalBridge
  }
}

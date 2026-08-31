import type { AppUpdateState } from '@/lib/appUpdate'
import type { WindowHotkeyState, WindowHotkeyUpdateResult } from '@/lib/windowHotkeyBinding'
import type { KeyChord } from '@/shortcuts/types'
import type { WindowSizePresetId } from '@/lib/windowBounds'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import type { PhysicalAssetRecord } from '@/storage/adapter'
import type { AssetPurgePreview, AssetPurgeRecovery, AssetPurgeResult } from '@/storage/adapter'
import type { LiveStage, ScheduledStageRollover } from '@/lib/liveStages'

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

export type BackupRestoreResult =
  | { ok: true; committed: true; snapshot: PersistedSnapshot }
  | { ok: false; committed: boolean; error?: string }

export interface PreparedJournalImportPreview {
  token: string
  fileName: string
  modifiedAt: number
  tradeCount: number
  strategyCount: number
  attachmentCount: number
  attachmentBytes: number
  verification: 'verified'
  expiresAt: number
}

export type PrepareJournalImportResult =
  | { ok: true; preview: PreparedJournalImportPreview }
  | { ok: false; canceled?: boolean; error?: string }

export type CommitJournalImportResult =
  | { ok: true; committed: true; snapshot: PersistedSnapshot | null }
  | { ok: false; committed: boolean; error?: string; code?: 'LIBRARY_BUSY' | 'TOKEN_EXPIRED' | 'SOURCE_CHANGED' }

export interface StorageRecoveryRequiredState {
  code: 'storage-write-indeterminate'
  message: string
}

export type StorageRecoveryResult =
  | { ok: true; snapshot: PersistedSnapshot | null }
  | {
      ok: false
      code: 'busy' | 'reopen-failed' | 'renderer-reload-failed'
      message: string
    }

export interface StageRolloverCommitInput {
  expectedCurrentStageId: string
  expectedRollover: ScheduledStageRollover
}

/** 主进程完成耐久写入后，renderer 唯一允许发布的安全阶段视图。 */
export interface StageRolloverPublishState {
  liveStages: LiveStage[]
  currentLiveStageId: string
  scheduledStageRollover: null
}

export type StageRolloverCommitResult =
  | { ok: true; publish: StageRolloverPublishState }
  | {
      ok: false
      reason: 'stale' | 'backup-failed' | 'validation-failed' | 'write-failed' | 'recovery-required'
      message: string
    }

export type WindowFrameState = {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
  resizable: boolean
  presetId: WindowSizePresetId | null
}

export type WindowsClosePreference = 'ask' | 'tray' | 'quit'
export type WindowsCloseChoice = Exclude<WindowsClosePreference, 'ask'>

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
  platform: 'win32' | 'darwin' | 'other'
  onBeforeClose(callback: () => void | Promise<void>): () => void
  onCloseSaveError(callback: (message: string) => void): () => void
  onAutoBackupFailure(callback: () => void): () => void
  onStorageRecoveryRequired(callback: (state: StorageRecoveryRequiredState) => void): () => void
  onWindowsCloseExplanation(callback: () => void): () => void
  onWindowsClosePreferenceError(callback: (message: string) => void): () => void
  resolveWindowsClose(choice: WindowsCloseChoice, remember: boolean): Promise<void>
  getWindowsClosePreference(): Promise<WindowsClosePreference>
  setWindowsClosePreference(preference: WindowsClosePreference): Promise<WindowsClosePreference>
  requestClose(): Promise<void>
  toggleFullscreen(): Promise<boolean>
  getWindowHotkey(): Promise<WindowHotkeyState>
  setWindowHotkey(binding: KeyChord): Promise<WindowHotkeyUpdateResult>
  resetWindowHotkey(): Promise<WindowHotkeyUpdateResult>
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
  recoverStorage(): Promise<StorageRecoveryResult>
  getManifest(): Promise<LibraryManifest>
  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<boolean>
  commitStageRollover(input: StageRolloverCommitInput): Promise<StageRolloverCommitResult>
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
  prepareJournalImport(prepareRequestId: string): Promise<PrepareJournalImportResult>
  cancelPreparedJournalImport(tokenOrRequestId: string): Promise<{ ok: boolean; state: 'cancelled' | 'committing' | 'terminal' | 'missing' }>
  commitPreparedJournalImport(token: string): Promise<CommitJournalImportResult>
  createBackup(): Promise<string | null>
  listBackups(): Promise<BackupInfo[]>
  verifyBackup(fileName: string): Promise<BackupVerificationResult>
  restoreBackup(fileName: string): Promise<BackupRestoreResult>
  deleteBackup(fileName: string): Promise<boolean>
  getBackupStats(): Promise<{ count: number; totalSize: number }>
  getWindowState(): Promise<WindowFrameState | null>
  applyWindowPreset(
    presetId: WindowSizePresetId,
  ): Promise<{ ok: true; state: WindowFrameState } | { ok: false; error: string }>
  setWindowResizable(
    resizable: boolean,
  ): Promise<{ ok: true; state: WindowFrameState } | { ok: false; error: string }>
  getUpdateState(): Promise<AppUpdateState>
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

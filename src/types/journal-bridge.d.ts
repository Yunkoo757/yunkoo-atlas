import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import type { AppUpdateState } from '@/lib/appUpdate'
import type { WindowSizePresetId } from '@/lib/windowBounds'

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
}

export type WindowFrameState = {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
  presetId: WindowSizePresetId | null
}

export interface JournalBridge {
  isElectron: true
  /** 主窗口关闭前完成草稿与快照落盘。 */
  onBeforeClose(callback: () => void | Promise<void>): () => void
  onCloseSaveError(callback: (message: string) => void): () => void
  requestClose(): Promise<void>
  toggleFullscreen(): Promise<boolean>
  // 库路径引导
  getLibraryStatus(): Promise<{ initialized: boolean; path: string }>
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
  // 存储
  getLibraryPath(): Promise<string>
  storageOpen(): Promise<boolean>
  getManifest(): Promise<LibraryManifest>
  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<boolean>
  saveAsset(data: ArrayBuffer, mime: string): Promise<string>
  getAssetBytes(id: string): Promise<{ id: string; mime: string; bytes: Uint8Array } | null>
  getAssetStats(ids: string[]): Promise<{ count: number; totalBytes: number; missingCount: number }>
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
  // 备份
  createBackup(): Promise<string | null>
  listBackups(): Promise<BackupInfo[]>
  verifyBackup(fileName: string): Promise<BackupVerificationResult>
  restoreBackup(fileName: string): Promise<PersistedSnapshot | null>
  deleteBackup(fileName: string): Promise<boolean>
  getBackupStats(): Promise<{ count: number; totalSize: number }>
  // 窗口
  getWindowState(): Promise<WindowFrameState | null>
  applyWindowPreset(
    presetId: WindowSizePresetId,
  ): Promise<{ ok: true; state: WindowFrameState } | { ok: false; error: string }>
  // 应用更新
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

export {}

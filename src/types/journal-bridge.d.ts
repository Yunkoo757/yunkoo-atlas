import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'

export interface BackupInfo {
  name: string
  timestamp: number
  size: number
  tradeCount?: number
  strategyCount?: number
  attachmentCount?: number
}

export interface JournalBridge {
  isElectron: true
  // 库路径引导
  getLibraryStatus(): Promise<{ initialized: boolean; path: string }>
  pickLibraryFolder(): Promise<string | null>
  createNewLibrary(libPath: string): Promise<{ ok: boolean }>
  openExistingLibrary(libPath: string): Promise<{ ok: boolean; error?: string }>
  // 存储
  getLibraryPath(): Promise<string>
  storageOpen(): Promise<boolean>
  getManifest(): Promise<LibraryManifest>
  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<boolean>
  saveAsset(data: ArrayBuffer, mime: string): Promise<string>
  getAssetBytes(id: string): Promise<{ id: string; mime: string; bytes: Uint8Array } | null>
  importAssets(assets: ExportAssetRecord[]): Promise<boolean>
  exportJournalZip(): Promise<{ ok: true; path: string } | { ok: false }>
  importJournalZip(): Promise<
    | { ok: true; snapshot: PersistedSnapshot | null }
    | { ok: false; canceled?: boolean; error?: string }
  >
  // 备份
  createBackup(): Promise<string | null>
  listBackups(): Promise<BackupInfo[]>
  restoreBackup(fileName: string): Promise<PersistedSnapshot | null>
  deleteBackup(fileName: string): Promise<boolean>
  getBackupStats(): Promise<{ count: number; totalSize: number }>
}

declare global {
  interface Window {
    journalBridge?: JournalBridge
  }
}

export {}

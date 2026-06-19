import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'

export interface BackupInfo {
  name: string
  timestamp: number
  size: number
}

export interface JournalBridge {
  isElectron: true
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
    { ok: true; snapshot: PersistedSnapshot | null } | { ok: false }
  >
  // 备份
  createBackup(): Promise<string | null>
  listBackups(): Promise<BackupInfo[]>
  restoreBackup(fileName: string): Promise<boolean>
  deleteBackup(fileName: string): Promise<boolean>
}

declare global {
  interface Window {
    journalBridge?: JournalBridge
  }
}

export {}

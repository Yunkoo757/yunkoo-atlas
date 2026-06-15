import { contextBridge, ipcRenderer } from 'electron'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '../src/storage/types'

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
}

const bridge: JournalBridge = {
  isElectron: true,
  getLibraryPath: () => ipcRenderer.invoke('library:getPath'),
  storageOpen: () => ipcRenderer.invoke('storage:open'),
  getManifest: () => ipcRenderer.invoke('storage:getManifest'),
  loadSnapshot: () => ipcRenderer.invoke('storage:loadSnapshot'),
  saveSnapshot: (snapshot) => ipcRenderer.invoke('storage:saveSnapshot', snapshot),
  saveAsset: (data, mime) =>
    ipcRenderer.invoke('storage:saveAsset', { data, mime }),
  getAssetBytes: (id) => ipcRenderer.invoke('storage:getAssetBytes', id),
  importAssets: (assets) => ipcRenderer.invoke('storage:importAssets', assets),
  exportJournalZip: () => ipcRenderer.invoke('journal:exportZip'),
  importJournalZip: () => ipcRenderer.invoke('journal:importZip'),
}

contextBridge.exposeInMainWorld('journalBridge', bridge)

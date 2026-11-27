import { isSafeAssetId } from './assetId'

/** Physical layout shared by the three writers that create new desktop databases. */
export const CREATE_LIBRARY_TABLES_SQL = `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    file_name TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`

const reservedDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const portableExtension = /^[A-Za-z0-9][A-Za-z0-9!#$&^._+-]{0,127}$/

export function isPortableAssetFileName(id: string, fileName: string): boolean {
  if (!isSafeAssetId(id) || reservedDevice.test(id) || typeof fileName !== 'string') return false
  return fileName.length <= 255 && fileName.startsWith(id + '.') && !fileName.endsWith('.') &&
    portableExtension.test(fileName.slice(id.length + 1))
}

export function validateLibraryAssetIndex(records: Iterable<{ id: string; fileName: string }>): Set<string> {
  const ids = new Set<string>()
  const portableIds = new Set<string>()
  for (const { id, fileName } of records) {
    if (!isPortableAssetFileName(id, fileName) || portableIds.has(id.toLowerCase())) {
      throw new Error('资料库附件索引存在不可移植的 ID 或文件名碰撞，已停止附件操作')
    }
    // Every accepted filename starts with its exact ID and a dot, so distinct
    // case-folded IDs also guarantee distinct physical filenames.
    portableIds.add(id.toLowerCase())
    ids.add(id)
  }
  return ids
}

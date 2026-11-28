import type { Database } from 'sql.js'
import { decodeSnapshotRevision, SNAPSHOT_REVISION_KEY } from './snapshotRevision'
import { SCHEMA_VERSION } from './types'
import { rejectFutureManifestVersion } from './manifestCompatibility'
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

export function readDatabaseSnapshotRevision(db: Database): number {
  const result = db.exec('SELECT value FROM meta WHERE key = ?', [SNAPSHOT_REVISION_KEY])
  const row = result[0]?.values[0] ?? []
  const value = row[0]
  // SQLite 写为十进制文本，允许旧库带前导零；空白、浮点和二进制不能当作修订。
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return decodeSnapshotRevision([Number(value)])
  }
  return decodeSnapshotRevision(row)
}

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

/** 旧资料库可能保留 v1-v7 清单；数据库内版本才是已保存快照的版本。 */
export function resolveSnapshotVersion(snapshot: unknown, databaseVersion: number | null, manifestVersion: number): number {
  rejectFutureManifestVersion(manifestVersion)
  if (databaseVersion !== null) {
    if (!Number.isInteger(databaseVersion) || databaseVersion < 1 || databaseVersion > SCHEMA_VERSION) {
      throw new Error('数据库版本无效或来自更新版本，请使用支持该资料库版本的 Atlas')
    }
    return databaseVersion
  }
  const value = snapshot as Record<string, unknown> | null
  const canonicalStage = value && typeof value === 'object' && !Array.isArray(value) &&
    Array.isArray(value.liveStages) && typeof value.currentLiveStageId === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'scheduledStageRollover')
  return manifestVersion <= 7 && canonicalStage ? 12 : manifestVersion
}

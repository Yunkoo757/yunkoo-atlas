import { SCHEMA_VERSION } from '../../src/storage/types'

/** 旧资料库可能保留 v1-v7 清单；数据库内版本才是已保存快照的版本。 */
export function resolveSnapshotVersion(snapshot: unknown, databaseVersion: number | null, manifestVersion: number): number {
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

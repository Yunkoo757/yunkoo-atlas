import { SCHEMA_VERSION } from './types'
import { resolveSnapshotVersion } from './libraryDatabase'

export function testSnapshotVersionAlwaysRejectsAFutureManifest() {
  for (const databaseVersion of [null, SCHEMA_VERSION]) {
    let message = ''
    try { resolveSnapshotVersion({}, databaseVersion, SCHEMA_VERSION + 1) }
    catch (error) { message = String(error) }
    if (!message.includes('更新版本')) throw new Error('未来清单不能当成当前数据库或无版本旧库读取')
  }
}

export function testSnapshotVersionUsesPersistedVersionAndRejectsInvalidMetadata() {
  if (resolveSnapshotVersion({}, SCHEMA_VERSION, 5) !== SCHEMA_VERSION) throw new Error('旧清单覆盖了数据库版本')
  if (resolveSnapshotVersion({}, null, 5) !== 5) throw new Error('真正的旧快照必须保留原解码方式')
  const stage = { liveStages: [], currentLiveStageId: 'stage', scheduledStageRollover: null }
  if (resolveSnapshotVersion(stage, null, 5) !== 12) throw new Error('无 DB 版本的阶段快照必须保持兼容')
  for (const version of [0, NaN, 1.5, SCHEMA_VERSION + 1]) {
    let rejected = false
    try { resolveSnapshotVersion({}, version, 5) } catch { rejected = true }
    if (!rejected) throw new Error('不能通过旧清单绕过无效或未来数据库版本')
  }
}

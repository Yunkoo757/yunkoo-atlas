import fs from 'node:fs'
import path from 'node:path'
import electronRuntime from 'electron'
import initSqlJs, { type Database } from 'sql.js'
import { randomUUID } from 'node:crypto'
import type { LibraryManifest, PersistedSnapshot } from '../../src/storage/types'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { assertValidPersistedSnapshot } from '../../src/storage/snapshotValidation'
import { ensureLibraryDirs, findAttachmentFile, getLibraryPath } from './paths'
import { isImageMime, processImageBuffer } from './images'
import { writeFileAtomicallySync } from './atomicFile'
import { assertSafeAssetId } from '../../src/storage/assetId'
import {
  collectSnapshotBootstrapMutations,
  collectSnapshotMutations,
  planLocalSyncBatch,
} from '../../src/sync/localJournal'
import { planRemoteSnapshotApply } from '../../src/sync/remoteApply'
import type {
  LocalSyncStatus,
  RemoteSyncApplyResult,
  RemoteSyncOperation,
  SnapshotMutation,
  SyncConflict,
  SyncOutboxOperation,
} from '../../src/sync/types'

const SNAPSHOT_KEY = 'snapshot'
const SYNC_STATE_ROW_ID = 1

/** iCloud 冲突副本：journal 2.db / journal(1).db / journal (3).db */
const ICLOUD_CONFLICT_DB_RE = /^journal(?:\s+\d+|\s*\(\d+\))\.db$/i

export interface AssetBytes {
  id: string
  mime: string
  bytes: Uint8Array
}

let sqlPromise: ReturnType<typeof initSqlJs> | null = null
const electronApp =
  typeof electronRuntime === 'object' && electronRuntime !== null && 'app' in electronRuntime
    ? (electronRuntime as { app?: { getAppPath(): string } }).app
    : undefined

function resolveAttachmentWritePath(attachmentsRoot: string, fileName: string): string {
  const resolvedRoot = path.resolve(attachmentsRoot)
  const resolvedTarget = path.resolve(resolvedRoot, fileName)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('附件写入路径越界')
  }
  return resolvedTarget
}

function fileSizeIfPresent(filePath: string): number {
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() ? stat.size : -1
  } catch {
    return -1
  }
}

async function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => {
        const candidates = [
          typeof process.resourcesPath === 'string'
            ? path.join(process.resourcesPath, file)
            : null,
          typeof electronApp?.getAppPath === 'function'
            ? path.join(electronApp.getAppPath(), 'dist-electron', file)
            : null,
          typeof electronApp?.getAppPath === 'function'
            ? path.join(electronApp.getAppPath(), file)
            : null,
          path.join(process.cwd(), 'dist-electron', file),
          path.join(process.cwd(), 'node_modules/sql.js/dist', file),
        ].filter((candidate): candidate is string => candidate !== null)
        for (const p of candidates) {
          if (fs.existsSync(p)) return p
        }
        return path.join(process.cwd(), 'node_modules/sql.js/dist', file)
      },
    })
  }
  return sqlPromise
}

/**
 * 当 journal.db 被 iCloud 改名为冲突副本时，选体积最大且较新的一份恢复。
 * 返回候选绝对路径；无候选则 null。
 */
export function findIcloudConflictDbCandidate(libraryRoot: string): string | null {
  if (!fs.existsSync(libraryRoot)) return null
  const candidates: { path: string; size: number; mtimeMs: number }[] = []
  for (const name of fs.readdirSync(libraryRoot)) {
    if (!ICLOUD_CONFLICT_DB_RE.test(name)) continue
    const full = path.join(libraryRoot, name)
    try {
      const st = fs.statSync(full)
      if (!st.isFile() || st.size < 1024) continue
      candidates.push({ path: full, size: st.size, mtimeMs: st.mtimeMs })
    } catch {
      /* skip */
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.size - a.size || b.mtimeMs - a.mtimeMs)
  return candidates[0]?.path ?? null
}

export class LibraryStorage {
  private db: Database | null = null
  private paths: ReturnType<typeof ensureLibraryDirs>

  constructor(libraryPath = getLibraryPath()) {
    this.paths = ensureLibraryDirs(path.resolve(libraryPath))
  }

  getLibraryPath(): string {
    return this.paths.root
  }

  getPaths() {
    return this.paths
  }

  async open(): Promise<void> {
    if (this.db) return
    const SQL = await getSql()
    let created = !fs.existsSync(this.paths.dbFile)

    // journal.db 缺失但库目录已有 manifest / 冲突副本：禁止静默建空库（会清空交易与头像）
    if (created) {
      const conflict = findIcloudConflictDbCandidate(this.paths.root)
      if (conflict) {
        console.warn('[library] journal.db missing; recovering from iCloud conflict copy:', conflict)
        fs.copyFileSync(conflict, this.paths.dbFile)
        created = false
      } else if (fs.existsSync(this.paths.manifestFile)) {
        throw new Error(
          'journal.db 缺失，但本目录已有库清单（manifest.json）。' +
            '常见于 iCloud 尚未下完或同步冲突。请等待同步完成，或从设置 → 数据 → 备份中恢复。' +
            '已阻止写入空库，以免覆盖云端数据。',
        )
      }
    }

    if (created) {
      this.db = new SQL.Database()
    } else {
      const file = fs.readFileSync(this.paths.dbFile)
      this.db = new SQL.Database(file)
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        file_name TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        device_id TEXT NOT NULL,
        epoch INTEGER NOT NULL DEFAULT 1,
        device_seq INTEGER NOT NULL DEFAULT 0,
        pull_cursor TEXT,
        last_sync_at TEXT,
        bootstrap_prepared INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sync_outbox (
        op_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        device_seq INTEGER NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT,
        created_at TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        UNIQUE(entity_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS entity_versions (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(entity_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        conflict_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        local_revision INTEGER NOT NULL,
        remote_operation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'unresolved'
      );
      CREATE INDEX IF NOT EXISTS sync_outbox_device_seq_idx
        ON sync_outbox(device_seq);
    `)

    const syncStateColumns = this.db.exec('PRAGMA table_info(sync_state)')[0]?.values ?? []
    const syncStateColumnNames = new Set(syncStateColumns.map((row) => String(row[1])))
    const addedBootstrapColumn = !syncStateColumnNames.has('bootstrap_prepared')
    if (addedBootstrapColumn) {
      this.db.run('ALTER TABLE sync_state ADD COLUMN bootstrap_prepared INTEGER NOT NULL DEFAULT 0')
    }

    const syncStateExists = this.hasSyncState()
    if (!syncStateExists) {
      this.db.run(
        `INSERT INTO sync_state (id, device_id, epoch, device_seq)
         VALUES (?, ?, 1, 0)`,
        [SYNC_STATE_ROW_ID, randomUUID()],
      )
    }

    if (created || !fs.existsSync(this.paths.manifestFile)) {
      this.writeManifest({
        schemaVersion: SCHEMA_VERSION,
        libraryId: randomUUID(),
        createdAt: new Date().toISOString(),
        platform: 'electron',
      })
    }

    // 仅新建库时落盘。每次 open 都 rewrite 会在 iCloud 上制造大量冲突副本。
    if (created || !syncStateExists || addedBootstrapColumn) {
      this.persistDb()
    }
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  /** Close db without a final export; mutations already persist at write time. */
  release(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  private requireDb(): Database {
    if (!this.db) throw new Error('Library database not opened')
    return this.db
  }

  private persistDb(): void {
    if (!this.db) return
    const data = this.db.export()
    writeFileAtomicallySync(this.paths.dbFile, Buffer.from(data))
  }

  readManifest(): LibraryManifest {
    if (!fs.existsSync(this.paths.manifestFile)) {
      const manifest: LibraryManifest = {
        schemaVersion: SCHEMA_VERSION,
        libraryId: randomUUID(),
        createdAt: new Date().toISOString(),
        platform: 'electron',
      }
      this.writeManifest(manifest)
      return manifest
    }
    return JSON.parse(fs.readFileSync(this.paths.manifestFile, 'utf8')) as LibraryManifest
  }

  writeManifest(manifest: LibraryManifest): void {
    writeFileAtomicallySync(
      this.paths.manifestFile,
      JSON.stringify(manifest, null, 2),
      'utf8',
    )
  }

  private hasSyncState(): boolean {
    const db = this.requireDb()
    const stmt = db.prepare('SELECT 1 FROM sync_state WHERE id = ?')
    try {
      stmt.bind([SYNC_STATE_ROW_ID])
      return stmt.step()
    } finally {
      stmt.free()
    }
  }

  private getSyncStateRow(
    db: Database = this.requireDb(),
  ): Omit<LocalSyncStatus, 'libraryId' | 'pendingCount' | 'conflictCount'> {
    const stmt = db.prepare(
      `SELECT device_id, epoch, device_seq, pull_cursor, last_sync_at
       FROM sync_state WHERE id = ?`,
    )
    try {
      stmt.bind([SYNC_STATE_ROW_ID])
      if (!stmt.step()) throw new Error('Missing local sync state')
      const row = stmt.getAsObject() as {
        device_id: string
        epoch: number
        device_seq: number
        pull_cursor: string | null
        last_sync_at: string | null
      }
      return {
        deviceId: String(row.device_id),
        epoch: Number(row.epoch),
        deviceSeq: Number(row.device_seq),
        pullCursor: row.pull_cursor === null ? null : String(row.pull_cursor),
        lastSyncAt: row.last_sync_at === null ? null : String(row.last_sync_at),
      }
    } finally {
      stmt.free()
    }
  }

  private applyLocalSyncMutations(
    db: Database,
    mutations: SnapshotMutation[],
    createdAt: string,
  ): void {
    if (mutations.length === 0) return
    const state = this.getSyncStateRow(db)
    const versionStmt = db.prepare(
      'SELECT revision FROM entity_versions WHERE entity_type = ? AND entity_id = ?',
    )
    const pendingStmt = db.prepare(
      'SELECT base_revision FROM sync_outbox WHERE entity_type = ? AND entity_id = ?',
    )
    let batch: ReturnType<typeof planLocalSyncBatch>
    try {
      batch = planLocalSyncBatch({
        mutations,
        deviceId: state.deviceId,
        deviceSeq: state.deviceSeq,
        createdAt,
        createOperationId: randomUUID,
        getCurrentRevision: (entityType, entityId) => {
          versionStmt.bind([entityType, entityId])
          const revision = versionStmt.step()
            ? Number((versionStmt.getAsObject() as { revision: number }).revision)
            : 0
          versionStmt.reset()
          return revision
        },
        getPendingOperation: (entityType, entityId) => {
          pendingStmt.bind([entityType, entityId])
          const pending = pendingStmt.step()
            ? { baseRevision: Number((pendingStmt.getAsObject() as { base_revision: number }).base_revision) }
            : undefined
          pendingStmt.reset()
          return pending
        },
      })
    } finally {
      versionStmt.free()
      pendingStmt.free()
    }

    for (const version of batch.versions) {
      db.run(
        `INSERT INTO entity_versions (entity_type, entity_id, revision, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           revision = excluded.revision,
           deleted = excluded.deleted,
           updated_at = excluded.updated_at`,
        [version.entityType, version.entityId, version.revision, version.deleted ? 1 : 0, version.updatedAt],
      )
    }
    for (const operation of batch.operations) {
      db.run(
        `INSERT INTO sync_outbox (
           op_id, device_id, device_seq, entity_type, entity_id, kind,
           base_revision, revision, payload, created_at, state
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           op_id = excluded.op_id,
           device_id = excluded.device_id,
           device_seq = excluded.device_seq,
           kind = excluded.kind,
           base_revision = sync_outbox.base_revision,
           revision = excluded.revision,
           payload = excluded.payload,
           created_at = excluded.created_at,
           state = 'pending'`,
        [
          operation.opId, operation.deviceId, operation.deviceSeq,
          operation.entityType, operation.entityId, operation.kind,
          operation.baseRevision, operation.revision,
          operation.payload === null ? null : JSON.stringify(operation.payload), operation.createdAt,
        ],
      )
    }

    db.run('UPDATE sync_state SET device_seq = ? WHERE id = ?', [batch.deviceSeq, SYNC_STATE_ROW_ID])
  }

  loadSnapshot(): PersistedSnapshot | null {
    const db = this.requireDb()
    const stmt = db.prepare('SELECT value FROM meta WHERE key = ?')
    stmt.bind([SNAPSHOT_KEY])
    if (!stmt.step()) {
      stmt.free()
      return null
    }
    const value = String(stmt.getAsObject().value)
    stmt.free()
    const snapshot: unknown = JSON.parse(value)
    assertValidPersistedSnapshot(snapshot, 'Stored library snapshot')
    return snapshot
  }

  saveSnapshot(snapshot: PersistedSnapshot): void {
    assertValidPersistedSnapshot(snapshot, 'Library snapshot')
    const db = this.requireDb()
    const previous = this.loadSnapshot()
    const mutations = previous ? collectSnapshotMutations(previous, snapshot) : []
    db.run('BEGIN TRANSACTION')
    try {
      this.applyLocalSyncMutations(db, mutations, new Date().toISOString())
      db.run(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [SNAPSHOT_KEY, JSON.stringify(snapshot)],
      )
      db.run('COMMIT')
    } catch (error) {
      try { db.run('ROLLBACK') } catch { /* transaction may already be closed */ }
      throw error
    }
    this.persistDb()
  }

  getLocalSyncStatus(): LocalSyncStatus {
    const db = this.requireDb()
    const state = this.getSyncStateRow()
    const stmt = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM sync_outbox WHERE state = 'pending') AS pending_count,
        (SELECT COUNT(*) FROM sync_conflicts WHERE state = 'unresolved') AS conflict_count
    `)
    try {
      if (!stmt.step()) throw new Error('Unable to count pending sync operations')
      const counts = stmt.getAsObject() as { pending_count: number; conflict_count: number }
      return {
        libraryId: this.readManifest().libraryId,
        ...state,
        pendingCount: Number(counts.pending_count),
        conflictCount: Number(counts.conflict_count),
      }
    } finally {
      stmt.free()
    }
  }

  resetMetadataSyncEpoch(nextEpoch: number): void {
    if (!Number.isSafeInteger(nextEpoch) || nextEpoch < 1) {
      throw new Error('新的同步 epoch 无效')
    }
    const db = this.requireDb()
    const current = this.getSyncStateRow(db)
    if (nextEpoch <= current.epoch) {
      throw new Error('新的同步 epoch 必须大于当前值')
    }
    db.run('BEGIN TRANSACTION')
    try {
      db.run('DELETE FROM sync_outbox')
      db.run('DELETE FROM sync_conflicts')
      db.run('DELETE FROM entity_versions')
      db.run(
        `UPDATE sync_state
         SET epoch = ?, device_seq = 0, pull_cursor = NULL,
             last_sync_at = NULL, bootstrap_prepared = 0
         WHERE id = ?`,
        [nextEpoch, SYNC_STATE_ROW_ID],
      )
      db.run('COMMIT')
      this.persistDb()
    } catch (error) {
      try { db.run('ROLLBACK') } catch { /* transaction may already be closed */ }
      throw error
    }
  }

  adoptRemoteMetadataEpoch(
    nextEpoch: number,
    operations: RemoteSyncOperation[],
    pullCursor: string,
  ): PersistedSnapshot {
    if (!Number.isSafeInteger(nextEpoch) || nextEpoch < 1 || !pullCursor) {
      throw new Error('远端同步 epoch 检查点无效')
    }
    const db = this.requireDb()
    const currentState = this.getSyncStateRow(db)
    if (nextEpoch <= currentState.epoch) throw new Error('远端同步 epoch 没有推进')
    const currentSnapshot = this.loadSnapshot()
    if (!currentSnapshot) throw new Error('本地资料库尚未初始化')
    const requiredWorkspaceEntities = new Set([
      'collections', 'display', 'shortcuts', 'tags', 'profile', 'saved-trade-views', 'symbols',
    ])
    for (const operation of operations) {
      if (operation.entityType === 'workspace' && operation.kind === 'upsert') {
        requiredWorkspaceEntities.delete(operation.entityId)
      }
    }
    if (requiredWorkspaceEntities.size > 0) {
      throw new Error(`远端完整检查点缺少：${[...requiredWorkspaceEntities].join(', ')}`)
    }
    const emptySnapshot: PersistedSnapshot = {
      trades: [],
      strategies: [],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: currentSnapshot.display,
    }
    const plan = planRemoteSnapshotApply({
      snapshot: emptySnapshot,
      operations,
      localDeviceId: '__epoch_adoption__',
      getCurrentRevision: () => 0,
      hasPendingOperation: () => false,
    })
    if (plan.conflicts.length > 0 || plan.appliedCount !== operations.length) {
      throw new Error('远端完整检查点存在冲突或不连续历史')
    }
    assertValidPersistedSnapshot(plan.snapshot, 'Remote epoch snapshot')
    const syncedAt = new Date().toISOString()
    db.run('BEGIN TRANSACTION')
    try {
      db.run('DELETE FROM sync_outbox')
      db.run('DELETE FROM sync_conflicts')
      db.run('DELETE FROM entity_versions')
      db.run(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [SNAPSHOT_KEY, JSON.stringify(plan.snapshot)],
      )
      for (const version of plan.versions) {
        db.run(
          `INSERT INTO entity_versions (
             entity_type, entity_id, revision, deleted, updated_at
           ) VALUES (?, ?, ?, ?, ?)`,
          [
            version.entityType,
            version.entityId,
            version.revision,
            version.deleted ? 1 : 0,
            version.updatedAt,
          ],
        )
      }
      db.run(
        `UPDATE sync_state
         SET epoch = ?, device_seq = 0, pull_cursor = ?,
             last_sync_at = ?, bootstrap_prepared = 0
         WHERE id = ?`,
        [nextEpoch, pullCursor, syncedAt, SYNC_STATE_ROW_ID],
      )
      db.run('COMMIT')
      this.persistDb()
      return plan.snapshot
    } catch (error) {
      try { db.run('ROLLBACK') } catch { /* transaction may already be closed */ }
      throw error
    }
  }

  listPendingSyncOperations(limit = 500): SyncOutboxOperation[] {
    const db = this.requireDb()
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(Math.trunc(limit), 5000))
      : 500
    const stmt = db.prepare(
      `SELECT op_id, device_id, device_seq, entity_type, entity_id, kind,
              base_revision, revision, payload, created_at, state
       FROM sync_outbox
       WHERE state = 'pending'
       ORDER BY device_seq ASC
       LIMIT ?`,
    )
    const operations: SyncOutboxOperation[] = []
    try {
      stmt.bind([safeLimit])
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>
        operations.push({
          opId: String(row.op_id),
          deviceId: String(row.device_id),
          deviceSeq: Number(row.device_seq),
          entityType: String(row.entity_type) as SyncOutboxOperation['entityType'],
          entityId: String(row.entity_id),
          kind: String(row.kind) as SyncOutboxOperation['kind'],
          baseRevision: Number(row.base_revision),
          revision: Number(row.revision),
          payload: row.payload === null ? null : JSON.parse(String(row.payload)),
          createdAt: String(row.created_at),
          state: 'pending',
        })
      }
      return operations
    } finally {
      stmt.free()
    }
  }

  acknowledgeSyncOperations(operationIds: string[], pullCursor?: string): void {
    const db = this.requireDb()
    const uniqueIds = [...new Set(operationIds.filter(Boolean))]
    db.run('BEGIN TRANSACTION')
    try {
      for (const operationId of uniqueIds) {
        db.run('DELETE FROM sync_outbox WHERE op_id = ?', [operationId])
      }
      db.run(
        `UPDATE sync_state
         SET pull_cursor = COALESCE(?, pull_cursor), last_sync_at = ?
         WHERE id = ?`,
        [pullCursor ?? null, new Date().toISOString(), SYNC_STATE_ROW_ID],
      )
      db.run('COMMIT')
    } catch (error) {
      try { db.run('ROLLBACK') } catch { /* transaction may already be closed */ }
      throw error
    }
    this.persistDb()
  }

  isMetadataSyncBootstrapPrepared(): boolean {
    const stmt = this.requireDb().prepare(
      'SELECT bootstrap_prepared FROM sync_state WHERE id = ?',
    )
    try {
      stmt.bind([SYNC_STATE_ROW_ID])
      if (!stmt.step()) throw new Error('Missing local sync state')
      return Number((stmt.getAsObject() as { bootstrap_prepared: number }).bootstrap_prepared) === 1
    } finally {
      stmt.free()
    }
  }

  prepareMetadataSyncBootstrap(): number {
    const db = this.requireDb()
    if (this.isMetadataSyncBootstrapPrepared()) return 0
    const snapshot = this.loadSnapshot()
    const mutations = snapshot ? collectSnapshotBootstrapMutations(snapshot) : []
    db.run('BEGIN')
    try {
      this.applyLocalSyncMutations(db, mutations, new Date().toISOString())
      db.run(
        'UPDATE sync_state SET bootstrap_prepared = 1 WHERE id = ?',
        [SYNC_STATE_ROW_ID],
      )
      db.run('COMMIT')
      this.persistDb()
      return mutations.length
    } catch (error) {
      try { db.run('ROLLBACK') } catch { /* preserve the original failure */ }
      throw error
    }
  }

  applyRemoteSyncOperations(
    operations: RemoteSyncOperation[],
    pullCursor: string,
  ): RemoteSyncApplyResult {
    const db = this.requireDb()
    const snapshot = this.loadSnapshot()
    if (!snapshot) throw new Error('本地资料库尚未建立快照，无法应用远端同步')
    const state = this.getSyncStateRow(db)
    db.run('BEGIN TRANSACTION')
    try {
      const versionStmt = db.prepare(
        'SELECT revision FROM entity_versions WHERE entity_type = ? AND entity_id = ?',
      )
      const pendingStmt = db.prepare(
        "SELECT 1 FROM sync_outbox WHERE entity_type = ? AND entity_id = ? AND state = 'pending'",
      )
      let plan: ReturnType<typeof planRemoteSnapshotApply>
      try {
        plan = planRemoteSnapshotApply({
          snapshot,
          operations,
          localDeviceId: state.deviceId,
          getCurrentRevision: (entityType, entityId) => {
            versionStmt.bind([entityType, entityId])
            const revision = versionStmt.step()
              ? Number((versionStmt.getAsObject() as { revision: number }).revision)
              : 0
            versionStmt.reset()
            return revision
          },
          hasPendingOperation: (entityType, entityId) => {
            pendingStmt.bind([entityType, entityId])
            const pending = pendingStmt.step()
            pendingStmt.reset()
            return pending
          },
        })
      } finally {
        versionStmt.free()
        pendingStmt.free()
      }
      assertValidPersistedSnapshot(plan.snapshot, 'Remote synced library snapshot')

      for (const version of plan.versions) {
        db.run(
          `INSERT INTO entity_versions (entity_type, entity_id, revision, deleted, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             revision = excluded.revision,
             deleted = excluded.deleted,
             updated_at = excluded.updated_at`,
          [version.entityType, version.entityId, version.revision, version.deleted ? 1 : 0, version.updatedAt],
        )
      }
      for (const conflict of plan.conflicts) {
        db.run(
          `INSERT INTO sync_conflicts (
             conflict_id, entity_type, entity_id, local_revision,
             remote_operation, created_at, state
           ) VALUES (?, ?, ?, ?, ?, ?, 'unresolved')
           ON CONFLICT(conflict_id) DO NOTHING`,
          [
            conflict.remoteOperation.opId,
            conflict.remoteOperation.entityType,
            conflict.remoteOperation.entityId,
            conflict.localRevision,
            JSON.stringify(conflict.remoteOperation),
            new Date().toISOString(),
          ],
        )
      }
      if (plan.appliedCount > 0) {
        db.run(
          `INSERT INTO meta (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [SNAPSHOT_KEY, JSON.stringify(plan.snapshot)],
        )
      }
      db.run(
        'UPDATE sync_state SET pull_cursor = ?, last_sync_at = ? WHERE id = ?',
        [pullCursor, new Date().toISOString(), SYNC_STATE_ROW_ID],
      )
      db.run('COMMIT')
      this.persistDb()
      return {
        appliedCount: plan.appliedCount,
        conflictCount: plan.conflicts.length,
        appliedOperations: plan.appliedOperations,
      }
    } catch (error) {
      try { db.run('ROLLBACK') } catch { /* transaction may already be closed */ }
      throw error
    }
  }

  listSyncConflicts(limit = 100): SyncConflict[] {
    const db = this.requireDb()
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(Math.trunc(limit), 1000))
      : 100
    const stmt = db.prepare(
      `SELECT conflict_id, entity_type, entity_id, local_revision,
              remote_operation, created_at, state
       FROM sync_conflicts
       WHERE state = 'unresolved'
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    const conflicts: SyncConflict[] = []
    try {
      stmt.bind([safeLimit])
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>
        conflicts.push({
          conflictId: String(row.conflict_id),
          entityType: String(row.entity_type) as SyncConflict['entityType'],
          entityId: String(row.entity_id),
          localRevision: Number(row.local_revision),
          remoteOperation: JSON.parse(String(row.remote_operation)) as RemoteSyncOperation,
          createdAt: String(row.created_at),
          state: 'unresolved',
        })
      }
      return conflicts
    } finally {
      stmt.free()
    }
  }

  async saveAssetAsync(buffer: Buffer, mime: string): Promise<string> {
    const db = this.requireDb()
    const id = randomUUID()
    const createdAt = new Date().toISOString()

    let outBuffer = buffer
    let outMime = mime
    let ext = 'bin'

    if (isImageMime(mime)) {
      const processed = await processImageBuffer(buffer, mime)
      outBuffer = processed.buffer
      outMime = processed.mime
      ext = processed.ext
    } else {
      ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'bin'
    }

    const fileName = `${id}.${ext}`
    assertSafeAssetId(id)
    const filePath = resolveAttachmentWritePath(this.paths.attachments, fileName)
    fs.writeFileSync(filePath, outBuffer)

    db.run(
      `INSERT INTO assets (id, mime, file_name, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mime = excluded.mime,
         file_name = excluded.file_name,
         byte_size = excluded.byte_size`,
      [id, outMime, fileName, outBuffer.byteLength, createdAt],
    )
    this.persistDb()
    return id
  }

  getAssetBytes(id: string): AssetBytes | null {
    const db = this.requireDb()
    const stmt = db.prepare('SELECT mime, file_name FROM assets WHERE id = ?')
    stmt.bind([id])
    if (!stmt.step()) {
      stmt.free()
      return null
    }
    const row = stmt.getAsObject() as { mime: string; file_name: string }
    stmt.free()

    const filePath =
      findAttachmentFile(this.paths.attachments, id) ??
      path.join(this.paths.attachments, row.file_name)
    if (!fs.existsSync(filePath)) return null
    const bytes = fs.readFileSync(filePath)
    return { id, mime: row.mime, bytes: new Uint8Array(bytes) }
  }

  /** 返回交易数 / 策略数 / 附件数，供备份元数据使用 */
  getCounts(): { tradeCount: number; strategyCount: number; assetCount: number } {
    const snapshot = this.loadSnapshot()
    const db = this.requireDb()
    let assetCount = 0
    try {
      const stmt = db.prepare('SELECT COUNT(*) as cnt FROM assets')
      if (stmt.step()) {
        assetCount = (stmt.getAsObject() as { cnt: number }).cnt
      }
      stmt.free()
    } catch { /* 忽略 */ }
    return {
      tradeCount: snapshot?.trades.length ?? 0,
      strategyCount: snapshot?.strategies.length ?? 0,
      assetCount,
    }
  }

  getAssetStats(ids: string[]): { count: number; totalBytes: number; missingCount: number } {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return { count: 0, totalBytes: 0, missingCount: 0 }

    const db = this.requireDb()
    const stmt = db.prepare('SELECT file_name, byte_size FROM assets WHERE id = ?')
    let count = 0
    let totalBytes = 0
    let missingCount = 0
    try {
      for (const id of uniqueIds) {
        stmt.bind([id])
        if (stmt.step()) {
          const row = stmt.getAsObject() as { file_name: string; byte_size: number }
          const byteSize = Number(row.byte_size)
          let actualSize = -1
          try {
            actualSize = fileSizeIfPresent(
              resolveAttachmentWritePath(this.paths.attachments, row.file_name),
            )
          } catch {
            /* 非法文件名按缺失处理 */
          }
          if (Number.isFinite(byteSize) && byteSize >= 0 && actualSize === byteSize) {
            count += 1
            totalBytes += actualSize
          } else {
            missingCount += 1
          }
        } else {
          missingCount += 1
        }
        stmt.reset()
      }
    } finally {
      stmt.free()
    }
    return { count, totalBytes, missingCount }
  }

  importAsset(id: string, mime: string, buffer: Buffer): void {
    const db = this.requireDb()
    assertSafeAssetId(id)
    const createdAt = new Date().toISOString()
    const ext = mime.includes('webp')
      ? 'webp'
      : mime.includes('png')
        ? 'png'
        : mime.includes('jpeg') || mime.includes('jpg')
          ? 'jpg'
          : 'bin'
    const fileName = `${id}.${ext}`
    const filePath = resolveAttachmentWritePath(this.paths.attachments, fileName)
    fs.writeFileSync(filePath, buffer)
    db.run(
      `INSERT INTO assets (id, mime, file_name, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mime = excluded.mime,
         file_name = excluded.file_name,
         byte_size = excluded.byte_size`,
      [id, mime, fileName, buffer.byteLength, createdAt],
    )
    this.persistDb()
  }

  /** 将导入附件与最终快照作为一次提交写入，失败时保持当前数据库不变。 */
  async commitImport(
    snapshot: PersistedSnapshot,
    assets: Array<{ id: string; mime: string; buffer: Buffer }>,
    options?: { pruneUnreferenced?: boolean },
  ): Promise<void> {
    assertValidPersistedSnapshot(snapshot, 'Imported library snapshot')
    const currentDb = this.requireDb()
    const previous = this.loadSnapshot()
    const mutations = previous ? collectSnapshotMutations(previous, snapshot) : []
    const SQL = await getSql()
    const nextDb = new SQL.Database(currentDb.export())
    const stagedFiles: Array<{ temp: string; target: string }> = []
    const committedFiles: string[] = []
    const referencedAssetIds = new Set<string>()
    for (const trade of snapshot.trades) {
      const re = /journal-asset:\/\/([^"'\s>]+)/g
      let match: RegExpExecArray | null
      while ((match = re.exec(trade.note)) !== null) referencedAssetIds.add(match[1])
    }
    const obsoleteImportedFiles: string[] = []
    let adopted = false

    try {
      nextDb.run('BEGIN TRANSACTION')
      this.applyLocalSyncMutations(nextDb, mutations, new Date().toISOString())
      for (const asset of assets) {
        assertSafeAssetId(asset.id)
        if (options?.pruneUnreferenced && !referencedAssetIds.has(asset.id)) {
          const existing = findAttachmentFile(this.paths.attachments, asset.id)
          if (existing) obsoleteImportedFiles.push(existing)
          nextDb.run('DELETE FROM assets WHERE id = ?', [asset.id])
          continue
        }
        const ext = asset.mime.includes('webp')
          ? 'webp'
          : asset.mime.includes('png')
            ? 'png'
            : asset.mime.includes('jpeg') || asset.mime.includes('jpg')
              ? 'jpg'
              : 'bin'
        const fileName = `${asset.id}.${ext}`
        const target = resolveAttachmentWritePath(this.paths.attachments, fileName)
        if (fs.existsSync(target)) {
          if (!fs.readFileSync(target).equals(asset.buffer)) {
            throw new Error(`导入附件 ID 冲突：${asset.id}`)
          }
        } else {
          const temp = resolveAttachmentWritePath(
            this.paths.attachments,
            `.${fileName}.${randomUUID()}.tmp`,
          )
          fs.writeFileSync(temp, asset.buffer)
          stagedFiles.push({ temp, target })
        }
        nextDb.run(
          `INSERT INTO assets (id, mime, file_name, byte_size, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             mime = excluded.mime,
             file_name = excluded.file_name,
             byte_size = excluded.byte_size`,
          [asset.id, asset.mime, fileName, asset.buffer.byteLength, new Date().toISOString()],
        )
      }
      nextDb.run(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [SNAPSHOT_KEY, JSON.stringify(snapshot)],
      )
      nextDb.run('COMMIT')

      for (const staged of stagedFiles) {
        fs.renameSync(staged.temp, staged.target)
        committedFiles.push(staged.target)
      }
      writeFileAtomicallySync(this.paths.dbFile, Buffer.from(nextDb.export()))
      currentDb.close()
      this.db = nextDb
      adopted = true
      for (const filePath of obsoleteImportedFiles) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch { /* orphan cleanup retries on next import */ }
      }
    } catch (error) {
      try { nextDb.run('ROLLBACK') } catch { /* transaction may already be closed */ }
      for (const staged of stagedFiles) {
        try { if (fs.existsSync(staged.temp)) fs.unlinkSync(staged.temp) } catch { /* ignore */ }
      }
      for (const filePath of committedFiles) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch { /* ignore */ }
      }
      throw error
    } finally {
      if (!adopted) nextDb.close()
    }
  }
}

import { assertEmptyMigrationTarget, type LibraryImportOptions } from '../../src/storage/adapter'
import { AssetPurgePreviews } from '../../src/storage/assetPurgePreviews'
import { readCompatibleLibraryManifest } from './libraryIdentity'
import { nextSnapshotRevision, SNAPSHOT_REVISION_KEY } from '../../src/storage/snapshotRevision'
import { CREATE_LIBRARY_TABLES_SQL, readDatabaseSnapshotRevision, resolveSnapshotVersion, isPortableAssetFileName, validateLibraryAssetIndex } from '../../src/storage/libraryDatabase'
import { stripRetiredSnapshotDomains } from '../../src/storage/retiredSnapshotDomains'
import { retiredSnapshotDatabaseBytes, stripRetiredSnapshotDomainsInDatabase } from './retiredSnapshotDatabase'
import fs from 'node:fs'
import path from 'node:path'
import type { Database } from 'sql.js'
import { getLibrarySql } from './sqliteRuntime'
import { randomUUID } from 'node:crypto'
import type { LibraryManifest, PersistedSnapshot } from '../../src/storage/types'
import type {
  AssetPurgePreview,
  AssetPurgeResult,
  PhysicalAssetRecord,
  LibraryImportAsset,
  SnapshotEnvelope,
} from '../../src/storage/adapter'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { assertValidPersistedSnapshot } from '../../src/storage/snapshotValidation'
import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { ensureLibraryDirs, getLibraryPaths } from './paths'
import { isImageMime, processImageBuffer } from './images'
import { fsyncDirectorySync, fsyncFileSync, writeFileAtomicallySync } from './atomicFile'
import { assertSafeAssetId, isSafeAssetId } from '../../src/storage/assetId'
import { buildAssetInventory } from '../../src/storage/assetInventory'
import { OperationalError } from '../../src/lib/operationalError'
import {
  assertOpenedPairVersion,
  migrateOpenedLibraryV8ToV9,
  recoverInterruptedSchemaMigrationFiles,
  removeMigrationRecovery,
  restoreVerifiedV8Pair,
} from './schemaMigration'
import { recoverInterruptedBackupRestore } from './backup'
import { recoverInterruptedJournalImport } from './journalZip'

const SNAPSHOT_KEY = 'snapshot'
const DATABASE_SCHEMA_KEY = 'schemaVersion'
const ASSET_TRASH_MANIFEST = 'manifest.json'
const ASSET_TRASH_CLEANUP = 'cleanup.json'
type SqlDatabaseConstructor = new (data?: ArrayLike<number> | null) => Database

interface PreparedDatabaseCandidate {
  candidateDb: Database
  previousDiskBytes: Buffer
  candidateBytes: Buffer
}

interface AssetTrashManifest {
  version: 1
  operationId: string
  files: Array<{ id: string; fileName: string }>
}

export interface AssetBytes {
  id: string
  mime: string
  bytes: Uint8Array
}

export type SnapshotSaveOutcome =
  | 'previous-unchanged'
  | 'indeterminate'

export type SnapshotSaveResult =
  | { kind: 'committed' }
  | { kind: 'committed-after-write-error' }

export type StorageWriteOperation = 'snapshot' | 'save-asset' | 'import-asset' | 'asset-purge'

/**
 * 原子替换抛错后的磁盘真相。indeterminate 会锁住当前实例，避免自动保存
 * 覆盖尚待人工/重启恢复的数据库证据。
 */
export class SnapshotSaveError extends Error {
  readonly outcome: SnapshotSaveOutcome
  readonly operation: StorageWriteOperation
  readonly cause: unknown

  constructor(
    outcome: SnapshotSaveOutcome,
    cause: unknown,
    operation: StorageWriteOperation = 'snapshot',
  ) {
    const subject = operation === 'snapshot' ? '资料库快照' : '资料库附件索引'
    super(
      outcome === 'previous-unchanged'
        ? `${subject}尚未写入，可安全重试`
        : `${subject}写入结果不确定，已停止继续读写`,
    )
    this.name = 'SnapshotSaveError'
    this.outcome = outcome
    this.operation = operation
    this.cause = cause
  }
}

function isPortableFileBasename(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    fileName.length <= 255 &&
    path.posix.basename(fileName) === fileName &&
    path.win32.basename(fileName) === fileName &&
    !/[\u0000-\u001f<>:"/\\|?*]/.test(fileName) &&
    !/[. ]$/.test(fileName)
  )
}

function resolveAttachmentWritePath(attachmentsRoot: string, fileName: string): string {
  if (
    !isPortableFileBasename(fileName)
  ) {
    throw new Error('附件文件名包含非法路径分隔符')
  }
  const resolvedRoot = path.resolve(attachmentsRoot)
  const resolvedTarget = path.resolve(resolvedRoot, fileName)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('附件写入路径越界')
  }
  return resolvedTarget
}

function readDatabaseMeta(db: Database, key: string): string | null {
  const stmt = db.prepare('SELECT value FROM meta WHERE key = ?')
  try {
    stmt.bind([key])
    return stmt.step() ? String(stmt.getAsObject().value) : null
  } finally { stmt.free() }
}

function advanceSnapshotRevision(db: Database, expected?: number): void {
  const current = readDatabaseSnapshotRevision(db)
  if (expected !== undefined && expected !== current) {
    throw new OperationalError('storage-revision-conflict', `资料库已被更新（预期版本 ${expected}，实际版本 ${current}），已阻止旧快照覆盖`)
  }
  db.run(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [SNAPSHOT_REVISION_KEY, String(nextSnapshotRevision(current))],
  )
}

function writeDatabaseSnapshot(db: Database, snapshot: PersistedSnapshot, expectedRevision?: number): void {
  advanceSnapshotRevision(db, expectedRevision)
  db.run(
    `INSERT INTO meta (key, value) VALUES (?, ?), (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SNAPSHOT_KEY, JSON.stringify(snapshot), DATABASE_SCHEMA_KEY, String(SCHEMA_VERSION)],
  )
}

function readAssetFileName(db: Database, id: string): string | null {
  const stmt = db.prepare('SELECT file_name FROM assets WHERE id = ?')
  try {
    stmt.bind([id])
    return stmt.step() ? String(stmt.getAsObject().file_name) : null
  } finally {
    stmt.free()
  }
}

function safeMimeSubtype(mime: string): string {
  const normalized = mime.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
    throw new Error('附件 MIME 格式无效')
  }
  return normalized.slice(normalized.indexOf('/') + 1)
}

function savedAttachmentExtensionForMime(mime: string): string {
  const subtype = safeMimeSubtype(mime)
  return subtype === 'jpeg' ? 'jpg' : subtype
}

function importedAttachmentExtensionForMime(mime: string): string {
  const subtype = safeMimeSubtype(mime)
  if (subtype === 'webp' || subtype === 'png') return subtype
  if (subtype === 'jpeg' || subtype === 'jpg') return 'jpg'
  return 'bin'
}

function attachmentFileName(id: string, extension: string): string {
  assertSafeAssetId(id)
  if (!/^[a-z0-9][a-z0-9!#$&^._+-]{0,127}$/.test(extension)) throw new Error('附件扩展名格式无效')
  const fileName = `${id}.${extension}`
  if (!isPortableAssetFileName(id, fileName)) {
    throw new Error('附件文件名格式无效')
  }
  return fileName
}

function readAssetRecord(
  db: Database,
  id: string,
): { mime: string; fileName: string; byteSize: number } | null {
  const stmt = db.prepare('SELECT mime, file_name, byte_size FROM assets WHERE id = ?')
  try {
    stmt.bind([id])
    if (!stmt.step()) return null
    const row = stmt.getAsObject() as { mime: string; file_name: string; byte_size: number }
    return {
      mime: String(row.mime),
      fileName: String(row.file_name),
      byteSize: Number(row.byte_size),
    }
  } finally {
    stmt.free()
  }
}

interface PortableAssetRecord {
  id: string
  mime: string
  fileName: string
  byteSize: number
}

function readPortableAssetRecords(
  db: Database,
  id: string,
  fileName?: string,
): PortableAssetRecord[] {
  const stmt = db.prepare(
    fileName === undefined
      ? `SELECT id, mime, file_name, byte_size
         FROM assets
         WHERE id = ? COLLATE NOCASE`
      : `SELECT id, mime, file_name, byte_size
         FROM assets
         WHERE id = ? COLLATE NOCASE OR file_name = ? COLLATE NOCASE`,
  )
  const records: PortableAssetRecord[] = []
  try {
    stmt.bind(fileName === undefined ? [id] : [id, fileName])
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        id: string
        mime: string
        file_name: string
        byte_size: number
      }
      records.push({
        id: String(row.id),
        mime: String(row.mime),
        fileName: String(row.file_name),
        byteSize: Number(row.byte_size),
      })
    }
    return records
  } finally {
    stmt.free()
  }
}

function assertPortableAssetDatabaseIntegrity(db: Database): void {
  const result = db.exec('SELECT id, file_name FROM assets ORDER BY id, file_name')
  const records = result[0]?.values ?? []
  validateLibraryAssetIndex(records.map(([id, fileName]) => ({ id: String(id), fileName: String(fileName) })))
}

function assertPortableSnapshotAssetReferences(
  snapshot: Parameters<typeof buildAssetInventory>[0],
  db: Database,
): void {
  for (const reference of buildAssetInventory(snapshot, []).referenced) {
    const portableRecords = readPortableAssetRecords(db, reference.id)
    if (portableRecords.length === 0) continue
    if (portableRecords.length !== 1 || portableRecords[0]?.id !== reference.id) {
      throw new Error('资料库快照与附件索引存在仅大小写不同的 ID 引用，已停止附件操作')
    }
  }
}

function assertRegularFile(filePath: string, label: string): fs.Stats {
  const stat = fs.lstatSync(filePath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} 必须是普通文件`)
  return stat
}

function readAssetTrashJournal(filePath: string, operationId: string): AssetTrashManifest {
  assertRegularFile(filePath, '附件恢复清单')
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AssetTrashManifest
  if (
    manifest.version !== 1 ||
    manifest.operationId !== operationId ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('附件恢复清单无效，已停止打开资料库')
  }
  const seenIds = new Set<string>()
  const seenNames = new Set<string>([ASSET_TRASH_MANIFEST, ASSET_TRASH_CLEANUP])
  for (const file of manifest.files) {
    if (
      !file ||
      !isSafeAssetId(file.id) ||
      typeof file.fileName !== 'string' ||
      !isPortableAssetFileName(file.id, file.fileName) ||
      seenIds.has(file.id.toLowerCase()) ||
      seenNames.has(file.fileName.toLowerCase())
    ) {
      throw new Error('附件恢复清单包含非法或重复路径')
    }
    seenIds.add(file.id.toLowerCase())
    seenNames.add(file.fileName.toLowerCase())
  }
  return manifest
}

export class LibraryStorage {
  private readonly lifecycleId = randomUUID()
  private db: Database | null = null
  private DatabaseClass: SqlDatabaseConstructor | null = null
  private paths: ReturnType<typeof ensureLibraryDirs>
  private readonly allowCreate: boolean
  private readonly writeImportDatabase: typeof writeFileAtomicallySync
  private readonly beforeAtomicReplace?: (temporaryPath: string) => void
  private readonly beforeSnapshotAtomicReplace?: (temporaryPath: string) => void
  private readonly afterSnapshotAtomicReplace?: (targetPath: string) => void
  private readonly beforeAssetAtomicReplace?: (temporaryPath: string) => void
  private readonly afterAssetAtomicReplace?: (targetPath: string) => void
  private readonly beforeAttachmentAtomicReplace?: (temporaryPath: string) => void
  private readonly afterAttachmentAtomicReplace?: (targetPath: string) => void
  private readonly readDatabaseFile: (filePath: string) => Buffer
  private readonly readAttachmentFile: (filePath: string) => Buffer
  private readonly removeAttachmentFile: (filePath: string) => void
  private readonly lstatAttachmentFile: (filePath: string) => fs.Stats
  private readonly fsyncAttachmentDirectory: (directoryPath: string) => boolean
  private readonly createDatabase: (
    DatabaseClass: SqlDatabaseConstructor,
    data?: ArrayLike<number> | null,
  ) => Database
  private readonly now: () => Date
  private storageWriteRecoveryError: SnapshotSaveError | null = null
  private readonly assetPurgePreviews = new AssetPurgePreviews<void>()

  constructor(
    libraryPath: string,
    options: {
      ensureDirectories?: boolean
      allowCreate?: boolean
      writeImportDatabase?: typeof writeFileAtomicallySync
      beforeAtomicReplace?: (temporaryPath: string) => void
      beforeSnapshotAtomicReplace?: (temporaryPath: string) => void
      afterSnapshotAtomicReplace?: (targetPath: string) => void
      beforeAssetAtomicReplace?: (temporaryPath: string) => void
      afterAssetAtomicReplace?: (targetPath: string) => void
      beforeAttachmentAtomicReplace?: (temporaryPath: string) => void
      afterAttachmentAtomicReplace?: (targetPath: string) => void
      readDatabaseFile?: (filePath: string) => Buffer
      readAttachmentFile?: (filePath: string) => Buffer
      removeAttachmentFile?: (filePath: string) => void
      lstatAttachmentFile?: (filePath: string) => fs.Stats
      fsyncAttachmentDirectory?: (directoryPath: string) => boolean
      createDatabase?: (
        DatabaseClass: SqlDatabaseConstructor,
        data?: ArrayLike<number> | null,
      ) => Database
      now?: () => Date
    } = {},
  ) {
    const resolved = path.resolve(libraryPath)
    this.allowCreate = options.allowCreate !== false
    this.writeImportDatabase = options.writeImportDatabase ?? writeFileAtomicallySync
    this.beforeAtomicReplace = options.beforeAtomicReplace
    this.beforeSnapshotAtomicReplace = options.beforeSnapshotAtomicReplace
    this.afterSnapshotAtomicReplace = options.afterSnapshotAtomicReplace
    this.beforeAssetAtomicReplace = options.beforeAssetAtomicReplace
    this.afterAssetAtomicReplace = options.afterAssetAtomicReplace
    this.beforeAttachmentAtomicReplace = options.beforeAttachmentAtomicReplace
    this.afterAttachmentAtomicReplace = options.afterAttachmentAtomicReplace
    this.readDatabaseFile = options.readDatabaseFile ?? ((filePath) => fs.readFileSync(filePath))
    this.readAttachmentFile = options.readAttachmentFile ?? ((filePath) => fs.readFileSync(filePath))
    this.removeAttachmentFile = options.removeAttachmentFile ?? ((filePath) => fs.rmSync(filePath))
    this.lstatAttachmentFile = options.lstatAttachmentFile ?? ((filePath) => fs.lstatSync(filePath))
    this.fsyncAttachmentDirectory = options.fsyncAttachmentDirectory ?? fsyncDirectorySync
    this.createDatabase = options.createDatabase ?? (
      (DatabaseClass, data) => new DatabaseClass(data)
    )
    this.now = options.now ?? (() => new Date())
    this.paths = options.ensureDirectories === false
      ? getLibraryPaths(resolved)
      : ensureLibraryDirs(resolved)
  }

  getLibraryPath(): string {
    return this.paths.root
  }

  getLifecycleId(): string {
    return this.lifecycleId
  }

  isRecoveryRequired(): boolean {
    return this.storageWriteRecoveryError !== null
  }

  getPaths() {
    return this.paths
  }

  async open(expectedLibraryId?: string): Promise<void> {
    if (this.storageWriteRecoveryError) throw this.storageWriteRecoveryError
    if (this.db) {
      if (expectedLibraryId !== undefined) this.readManifest(expectedLibraryId)
      return
    }
    try {
      recoverInterruptedJournalImport(this.paths, expectedLibraryId)
      recoverInterruptedBackupRestore(this.paths, expectedLibraryId)
      const schemaRecovery = recoverInterruptedSchemaMigrationFiles(this.paths, expectedLibraryId)
      if ((!this.allowCreate || expectedLibraryId !== undefined) && !fs.existsSync(this.paths.manifestFile)) {
        throw new Error('manifest.json 不存在，已阻止生成新的资料库身份')
      }
      const SQL = await getLibrarySql()
      this.DatabaseClass = SQL.Database
      let created = false

      if (schemaRecovery.kind === 'pending-v9-validation') {
        try {
          if (!fs.existsSync(this.paths.dbFile)) throw new Error('正式 v9 journal.db 不存在')
          this.db = this.createDatabase(SQL.Database, this.readDatabaseFile(this.paths.dbFile))
          const manifest = this.readManifest(expectedLibraryId)
          assertOpenedPairVersion(this.db, manifest, SCHEMA_VERSION, {
            requireSnapshot: true,
          })
        } catch {
          this.closeDatabaseBestEffort()
          restoreVerifiedV8Pair(this.paths, schemaRecovery.marker, expectedLibraryId)
          this.db = this.createDatabase(SQL.Database, this.readDatabaseFile(this.paths.dbFile))
          assertOpenedPairVersion(this.db, this.readManifest(expectedLibraryId), schemaRecovery.marker.fromVersion, { requireSnapshot: true })
        }
        removeMigrationRecovery(this.paths, schemaRecovery.marker)
        created = false
      } else {
        created = !fs.existsSync(this.paths.dbFile)
        if (created && (!this.allowCreate || expectedLibraryId !== undefined)) {
          throw new Error('journal.db 不存在，已阻止创建空交易库')
        }
        if (created && fs.existsSync(this.paths.manifestFile)) {
          throw new Error(
            'journal.db 缺失，但本目录已有资料库清单（manifest.json）。' +
              '请从设置 → 数据 → 备份中恢复，或重新选择正确的资料库目录。' +
              '已阻止写入空库，以免覆盖现有记录。',
          )
        }
        this.db = created
          ? this.createDatabase(SQL.Database)
          : this.createDatabase(SQL.Database, this.readDatabaseFile(this.paths.dbFile))
      }

      if (created) {
        this.db.run(CREATE_LIBRARY_TABLES_SQL)
        if (this.allowCreate && !fs.existsSync(this.paths.manifestFile)) {
          this.writeManifest({
            schemaVersion: SCHEMA_VERSION,
            libraryId: randomUUID(),
            createdAt: this.now().toISOString(),
            platform: 'electron',
          })
        }
        this.db.run(
          `INSERT INTO meta (key, value) VALUES ('schemaVersion', ?)`,
          [String(SCHEMA_VERSION)],
        )
        this.persistDb()
      }

      const manifest = this.readManifest(expectedLibraryId)
      if (manifest.schemaVersion >= 8 && manifest.schemaVersion < SCHEMA_VERSION) {
        migrateOpenedLibraryV8ToV9({
          db: this.db,
          paths: this.paths,
          manifest,
          now: this.now(),
        })
        this.closeDatabaseBestEffort()
        this.db = this.createDatabase(SQL.Database, this.readDatabaseFile(this.paths.dbFile))
      }
      // v1-v7 exact archives retain their manifest-driven compatibility decoder.
      // The recoverable file-pair protocol is intentionally scoped to v8 -> v9.
      const openedManifest = this.readManifest(expectedLibraryId)
      if (openedManifest.schemaVersion >= 8) {
        assertOpenedPairVersion(this.db, openedManifest, SCHEMA_VERSION)
      } else {
        readDatabaseSnapshotRevision(this.db)
      }
      // 启动恢复会移动或删除附件，必须先拒绝 Windows/macOS 上会共享
      // 同一物理路径的 legacy 大小写碰撞。
      assertPortableAssetDatabaseIntegrity(this.requireDb())
      this.recoverAssetTrash()
    } catch (error) {
      this.closeDatabaseBestEffort()
      throw error
    }
  }

  private closeDatabaseBestEffort(): void {
    const database = this.db
    this.db = null
    if (!database) return
    try {
      database.close()
    } catch {
      // 初始化/迁移失败时必须优先清除实例状态，close 错误不能阻止后续重试。
    }
  }

  close(): void {
    this.closeDatabaseBestEffort()
    this.assetPurgePreviews.clear()
  }

  /** Close db without a final export; mutations already persist at write time. */
  release(): void {
    this.closeDatabaseBestEffort()
    this.assetPurgePreviews.clear()
  }

  private requireDb(): Database {
    if (this.storageWriteRecoveryError) throw this.storageWriteRecoveryError
    if (!this.db) throw new Error('Library database not opened')
    return this.db
  }

  private closeDetachedDatabaseBestEffort(database: Database): void {
    try {
      database.close()
    } catch {
      // Detached candidate 从未再作为 active 使用；close 失败不得覆盖磁盘真相分类。
    }
  }

  private prepareDatabaseCandidate(
    mutate: (candidateDb: Database) => void,
  ): PreparedDatabaseCandidate {
    // requireDb 只负责验证当前生命周期仍可写；候选来源必须是 journal.db 的
    // 权威字节，不能 export active sql.js 后把尚未耐久的内存状态带进去。
    this.requireDb()
    const DatabaseClass = this.DatabaseClass
    if (!DatabaseClass) throw new Error('资料库 SQL 构造器尚未初始化')
    const previousDiskBytes = this.readDatabaseFile(this.paths.dbFile)
    const candidateDb = this.createDatabase(DatabaseClass, Buffer.from(previousDiskBytes))
    try {
      mutate(candidateDb)
      return {
        candidateDb,
        previousDiskBytes: Buffer.from(previousDiskBytes),
        candidateBytes: Buffer.from(candidateDb.export()),
      }
    } catch (error) {
      this.closeDetachedDatabaseBestEffort(candidateDb)
      throw error
    }
  }

  /** Read-only backup/export candidate; the active database and its revision are never committed. */
  exportSnapshotDatabaseBytes(): Buffer {
    let changed = false
    const prepared = this.prepareDatabaseCandidate(candidate => { changed = stripRetiredSnapshotDomainsInDatabase(candidate) })
    try {
      return changed ? prepared.candidateBytes : prepared.previousDiskBytes
    } finally {
      this.closeDetachedDatabaseBestEffort(prepared.candidateDb)
    }
  }

  /** Capture the initialized SQL constructor before a restore closes this storage lifecycle. */
  createSnapshotDatabaseCleaner(): (bytes: Buffer) => Buffer {
    this.requireDb()
    const DatabaseClass = this.DatabaseClass
    if (!DatabaseClass) throw new Error('资料库 SQL 构造器尚未初始化')
    return bytes => retiredSnapshotDatabaseBytes(bytes, DatabaseClass)
  }

  private durableDatabaseReferencesFile(databaseBytes: Buffer, fileName: string): boolean {
    const DatabaseClass = this.DatabaseClass
    if (!DatabaseClass) throw new Error('资料库 SQL 构造器尚未初始化')
    const durableDb = this.createDatabase(DatabaseClass, Buffer.from(databaseBytes))
    try {
      const stmt = durableDb.prepare('SELECT 1 FROM assets WHERE file_name = ? COLLATE NOCASE LIMIT 1')
      try {
        stmt.bind([fileName])
        return stmt.step()
      } finally {
        stmt.free()
      }
    } finally {
      durableDb.close()
    }
  }

  private enterStorageWriteRecoveryLock(
    operation: StorageWriteOperation,
    cause: unknown,
  ): SnapshotSaveError {
    this.closeDatabaseBestEffort()
    const failure = new SnapshotSaveError('indeterminate', cause, operation)
    this.storageWriteRecoveryError = failure
    return failure
  }

  private assertAttachmentsDirectorySafe(): void {
    const stat = fs.lstatSync(this.paths.attachments)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('attachments 路径必须是当前资料库内的普通目录')
    }
  }

  private lstatAttachmentTarget(filePath: string): fs.Stats | null {
    this.assertAttachmentsDirectorySafe()
    try {
      return this.lstatAttachmentFile(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private listPortableAttachmentMatches(id: string): string[] {
    this.assertAttachmentsDirectorySafe()
    const portablePrefix = `${id.toLowerCase()}.`
    return fs.readdirSync(this.paths.attachments)
      .filter((name) => name.toLowerCase().startsWith(portablePrefix))
      .sort((left, right) => left.localeCompare(right, 'en'))
  }

  private inspectPortableAttachment(
    id: string,
    expectedFileName: string,
    directoryIndex?: ReadonlyMap<string, readonly string[]>,
  ): string | null {
    const matches = directoryIndex
      ? directoryIndex.get(id.toLowerCase()) ?? []
      : this.listPortableAttachmentMatches(id)
    if (matches.length > 1) {
      throw new Error(`附件 ID 对应多个物理文件：${id}`)
    }
    const actualName = matches[0]
    if (actualName === undefined) return null
    if (actualName !== expectedFileName) {
      throw new Error(`附件文件名大小写或扩展名冲突：${id}`)
    }
    const filePath = resolveAttachmentWritePath(this.paths.attachments, actualName)
    const stat = this.lstatAttachmentTarget(filePath)
    if (stat === null) return null
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`附件必须是普通非符号链接文件：${id}`)
    }
    return filePath
  }

  private materializeAttachmentCandidate(
    operation: Extract<StorageWriteOperation, 'save-asset' | 'import-asset'>,
    filePath: string,
    bytes: Buffer,
  ): void {
    this.assertAttachmentsDirectorySafe()
    try {
      writeFileAtomicallySync(
        filePath,
        bytes,
        undefined,
        this.beforeAttachmentAtomicReplace,
        this.afterAttachmentAtomicReplace,
      )
      const committedStat = this.lstatAttachmentTarget(filePath)
      if (committedStat === null || committedStat.isSymbolicLink() || !committedStat.isFile()) {
        throw new Error('附件原子写入后目标不是普通非符号链接文件')
      }
      if (!this.readAttachmentFile(filePath).equals(bytes)) {
        throw new Error('附件原子写入后目标字节与候选不一致')
      }
      return
    } catch (writeError) {
      try {
        const stat = this.lstatAttachmentTarget(filePath)
        if (stat === null) {
          throw new SnapshotSaveError('previous-unchanged', writeError, operation)
        }
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw new Error('附件目标不是普通非符号链接文件')
        }
        const observedBytes = this.readAttachmentFile(filePath)
        if (observedBytes.equals(bytes)) {
          // rename 已完成、仅后续 durability barrier 报错：文件候选已经是磁盘真相。
          return
        }
        throw new Error('附件目标字节既非提交前状态也非候选状态')
      } catch (readError) {
        if (readError instanceof SnapshotSaveError) throw readError
        throw this.enterStorageWriteRecoveryLock(operation, {
          write: writeError,
          read: readError,
        })
      }
    }
  }

  private cleanupOwnedAttachment(
    databaseBytes: Buffer,
    fileName: string,
    filePath: string,
    expectedBytes: Buffer,
  ): void {
    if (this.durableDatabaseReferencesFile(databaseBytes, fileName)) return
    const stat = this.lstatAttachmentTarget(filePath)
    if (stat === null) return
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('待清理附件不是普通非符号链接文件')
    }
    if (!this.readAttachmentFile(filePath).equals(expectedBytes)) {
      throw new Error('待清理附件字节已变化，无法证明仍由本次写入拥有')
    }
    this.removeAttachmentFile(filePath)
    this.assertAttachmentsDirectorySafe()
    this.fsyncAttachmentDirectory(this.paths.attachments)
  }

  private commitDatabaseCandidate(
    operation: StorageWriteOperation,
    prepared: PreparedDatabaseCandidate,
    options: {
      beforeReplace?: (temporaryPath: string) => void
      afterReplace?: (targetPath: string) => void
      onPreviousUnchanged?: (observedDiskBytes: Buffer) => void
      writeDatabase?: typeof writeFileAtomicallySync
    } = {},
  ): SnapshotSaveResult {
    const { candidateDb, previousDiskBytes, candidateBytes } = prepared
    let candidateOwned = true
    try {
      try {
        const writeDatabase = options.writeDatabase ?? writeFileAtomicallySync
        writeDatabase(
          this.paths.dbFile,
          candidateBytes,
          undefined,
          options.beforeReplace,
          options.afterReplace,
        )
      } catch (cause) {
        let observedBytes: Buffer
        try {
          observedBytes = this.readDatabaseFile(this.paths.dbFile)
        } catch (readError) {
          throw this.enterStorageWriteRecoveryLock(operation, { write: cause, read: readError })
        }

        if (observedBytes.equals(candidateBytes)) {
          this.closeDatabaseBestEffort()
          this.db = candidateDb
          candidateOwned = false
          return { kind: 'committed-after-write-error' }
        }
        if (observedBytes.equals(previousDiskBytes)) {
          try {
            options.onPreviousUnchanged?.(observedBytes)
          } catch (cleanupError) {
            throw this.enterStorageWriteRecoveryLock(operation, {
              write: cause,
              cleanup: cleanupError,
            })
          }
          throw new SnapshotSaveError('previous-unchanged', cause, operation)
        }

        throw this.enterStorageWriteRecoveryLock(operation, cause)
      }

      this.closeDatabaseBestEffort()
      this.db = candidateDb
      candidateOwned = false
      return { kind: 'committed' }
    } finally {
      if (candidateOwned) this.closeDetachedDatabaseBestEffort(candidateDb)
    }
  }

  private persistDb(): void {
    if (!this.db) return
    const data = this.db.export()
    writeFileAtomicallySync(this.paths.dbFile, Buffer.from(data), undefined, this.beforeAtomicReplace)
  }

  readManifest(expectedLibraryId?: string): LibraryManifest {
    if (!fs.existsSync(this.paths.manifestFile)) {
      if (!this.allowCreate || expectedLibraryId !== undefined) {
        throw new Error('manifest.json 不存在，已阻止生成新的资料库身份')
      }
      const manifest: LibraryManifest = {
        schemaVersion: SCHEMA_VERSION,
        libraryId: randomUUID(),
        createdAt: new Date().toISOString(),
        platform: 'electron',
      }
      this.writeManifest(manifest)
      return manifest
    }
    return readCompatibleLibraryManifest(this.paths.manifestFile, expectedLibraryId)
  }

  writeManifest(manifest: LibraryManifest): void {
    writeFileAtomicallySync(
      this.paths.manifestFile,
      JSON.stringify(manifest, null, 2),
      'utf8',
    )
  }

  getSnapshotRevision(): number {
    return readDatabaseSnapshotRevision(this.requireDb())
  }

  loadSnapshotEnvelope(): SnapshotEnvelope {
    const db = this.requireDb()
    return { snapshot: this.loadDatabaseSnapshot(db), revision: readDatabaseSnapshotRevision(db) }
  }

  loadSnapshot(): PersistedSnapshot | null {
    return this.loadDatabaseSnapshot(this.requireDb())
  }

  private loadDatabaseSnapshot(db: Database): PersistedSnapshot | null {
    const value = readDatabaseMeta(db, SNAPSHOT_KEY)
    if (value === null) return null
    const snapshot: unknown = JSON.parse(value)
    const manifestVersion = this.readManifest().schemaVersion
    const schema = readDatabaseMeta(db, DATABASE_SCHEMA_KEY)
    const databaseVersion = schema === null ? null : Number(schema)
    if (databaseVersion !== null && (!Number.isInteger(databaseVersion) || databaseVersion < 1)) {
      throw new Error('journal.db 的 schemaVersion 无效')
    }
    // v1-v7 资料库历史上只更新 snapshot，而未同步提升 manifest。只要快照已经
    // 具备 v12 引入的显式阶段合同，就不得再次按旧 schema 迁移，否则人工保存的
    // liveStageId 会在每次重启时重新变回待整理。下一次保存会写入明确的 DB 版本。
    const snapshotVersion = resolveSnapshotVersion(snapshot, databaseVersion, manifestVersion)
    return decodeCanonicalSnapshot(snapshot, {
      version: snapshotVersion,
      label: 'Stored library snapshot',
    })
  }

  saveSnapshot(snapshot: PersistedSnapshot, expectedRevision?: number): SnapshotSaveResult {
    snapshot = stripRetiredSnapshotDomains(snapshot)
    assertValidPersistedSnapshot(snapshot, 'Library snapshot')
    const prepared = this.prepareDatabaseCandidate(db => writeDatabaseSnapshot(db, snapshot, expectedRevision))
    return this.commitDatabaseCandidate('snapshot', prepared, {
      beforeReplace: this.beforeSnapshotAtomicReplace ?? this.beforeAtomicReplace,
      afterReplace: this.afterSnapshotAtomicReplace,
    })
  }

  async saveAssetAsync(buffer: Buffer, mime: string): Promise<string> {
    const id = randomUUID()
    const createdAt = new Date().toISOString()

    let outBuffer = buffer
    let outMime = mime
    let ext = savedAttachmentExtensionForMime(mime)

    if (isImageMime(mime)) {
      const processed = await processImageBuffer(buffer, mime)
      outBuffer = processed.buffer
      outMime = processed.mime
      ext = savedAttachmentExtensionForMime(processed.mime)
    }

    const fileName = attachmentFileName(id, ext)
    const filePath = resolveAttachmentWritePath(this.paths.attachments, fileName)

    // 图片处理会让出事件循环；最后一个 await 后从权威 journal.db 建隔离候选，
    // 此后保持同步临界区。active sql.js 只有在候选已耐久提交后才会被替换。
    const prepared = this.prepareDatabaseCandidate((candidateDb) => {
      if (readPortableAssetRecords(candidateDb, id, fileName).length > 0) {
        throw new Error('附件 ID 碰撞，请重试保存')
      }
      candidateDb.run(
        `INSERT INTO assets (id, mime, file_name, byte_size, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           mime = excluded.mime,
           file_name = excluded.file_name,
           byte_size = excluded.byte_size`,
        [id, outMime, fileName, outBuffer.byteLength, createdAt],
      )
    })
    let candidateHandedOff = false
    let fileOwnedByAttempt = false
    try {
      if (this.inspectPortableAttachment(id, fileName)) {
        throw new Error('附件 ID 冲突，请重试保存')
      }
      this.materializeAttachmentCandidate('save-asset', filePath, outBuffer)
      fileOwnedByAttempt = true

      candidateHandedOff = true
      this.commitDatabaseCandidate('save-asset', prepared, {
        beforeReplace: this.beforeAssetAtomicReplace ?? this.beforeAtomicReplace,
        afterReplace: this.afterAssetAtomicReplace,
        onPreviousUnchanged: (observedDiskBytes) => {
          if (fileOwnedByAttempt) {
            this.cleanupOwnedAttachment(observedDiskBytes, fileName, filePath, outBuffer)
          }
        },
      })
    } catch (error) {
      if (!candidateHandedOff) {
        this.closeDetachedDatabaseBestEffort(prepared.candidateDb)
        try {
          if (fileOwnedByAttempt) {
            this.cleanupOwnedAttachment(prepared.previousDiskBytes, fileName, filePath, outBuffer)
          }
        } catch (cleanupError) {
          throw this.enterStorageWriteRecoveryLock('save-asset', { error, cleanup: cleanupError })
        }
      }
      throw error
    }
    return id
  }

  getAssetBytes(id: string): AssetBytes | null {
    const db = this.requireDb()
    assertSafeAssetId(id)
    const records = readPortableAssetRecords(db, id)
    if (records.length === 0) return null
    if (records.length > 1 || records[0]?.id !== id) {
      throw new Error(`附件 ID 存在不可移植的大小写冲突：${id}`)
    }
    const record = records[0]
    const filePath = this.inspectPortableAttachment(record.id, record.fileName)
    if (!filePath) return null
    const bytes = this.readAttachmentFile(filePath)
    return { id, mime: record.mime, bytes: new Uint8Array(bytes) }
  }

  /** 返回交易数 / 策略数 / 附件数，供备份元数据使用 */
  /** 备份与校验只认数据库已声明附件，忽略磁盘上尚未收尾的孤儿文件。 */
  private readCommittedAttachmentRows(): Array<{ fileName: string; byteSize: number }> {
    const db = this.requireDb()
    this.assertAttachmentsDirectorySafe()
    assertPortableAssetDatabaseIntegrity(db)
    // 本次同步盘点共享一个目录索引；不缓存跨操作的文件系统事实。
    const directoryNames = fs.readdirSync(this.paths.attachments)
    const directoryIndex = new Map<string, string[]>()
    for (const name of directoryNames) {
      const separator = name.indexOf('.')
      if (separator < 1) continue
      const key = name.slice(0, separator).toLowerCase()
      const matches = directoryIndex.get(key) ?? []
      matches.push(name)
      directoryIndex.set(key, matches)
    }
    const result = db.exec('SELECT id, file_name, byte_size FROM assets ORDER BY file_name')
    const rows = (result[0]?.values ?? []).map((row) => {
      const id = String(row[0])
      const fileName = String(row[1])
      if (!this.inspectPortableAttachment(id, fileName, directoryIndex)) {
        throw new Error(`数据库声明的附件缺失：${fileName}`)
      }
      return { fileName, byteSize: Number(row[2]) }
    })
    // 外部复制、重命名或目录替换不能在批次内绕过碰撞/路径检查。
    this.assertAttachmentsDirectorySafe()
    const observedNames = fs.readdirSync(this.paths.attachments)
    const expectedNames = new Set(directoryNames)
    if (observedNames.length !== directoryNames.length || observedNames.some(name => !expectedNames.has(name))) {
      throw new Error('附件目录在盘点期间发生变化，请重试')
    }
    return rows
  }

  listCommittedAttachmentFileNames(): string[] {
    return this.readCommittedAttachmentRows().map(({ fileName }) => fileName)
  }

  listCommittedAttachmentFiles(): Array<{ fileName: string; byteSize: number }> {
    return this.readCommittedAttachmentRows()
  }

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

    this.assertAttachmentsDirectorySafe()
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
            const filePath = resolveAttachmentWritePath(this.paths.attachments, row.file_name)
            const stat = this.lstatAttachmentTarget(filePath)
            actualSize = stat && !stat.isSymbolicLink() && stat.isFile() ? stat.size : -1
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

  listAssetRecords(): PhysicalAssetRecord[] {
    const db = this.requireDb()
    this.assertAttachmentsDirectorySafe()
    const records: PhysicalAssetRecord[] = []
    const representedFiles = new Set<string>()
    const result = db.exec('SELECT id, mime, file_name, byte_size FROM assets')
    for (const row of result[0]?.values ?? []) {
      const id = String(row[0])
      const mime = String(row[1])
      const fileName = String(row[2])
      const declaredBytes = Number(row[3])
      representedFiles.add(fileName)

      let state: PhysicalAssetRecord['state'] = 'missing'
      let actualBytes: number | undefined
      const legalName = isPortableAssetFileName(id, fileName)
      if (!isSafeAssetId(id) || !legalName) {
        state = 'foreign'
      } else {
        try {
          const filePath = resolveAttachmentWritePath(this.paths.attachments, fileName)
          const stat = fs.lstatSync(filePath)
          if (stat.isSymbolicLink() || !stat.isFile()) {
            state = 'foreign'
          } else {
            actualBytes = stat.size
            state = Number.isSafeInteger(declaredBytes) && declaredBytes >= 0 && stat.size === declaredBytes
              ? 'healthy'
              : 'size-mismatch'
          }
        } catch {
          state = 'missing'
        }
      }
      records.push({ id, mime, declaredBytes, actualBytes, state, source: 'committed' })
    }

    for (const entry of fs.readdirSync(this.paths.attachments, { withFileTypes: true })) {
      if (representedFiles.has(entry.name)) continue
      const filePath = path.join(this.paths.attachments, entry.name)
      let actualBytes: number | undefined
      if (entry.isFile()) actualBytes = fs.lstatSync(filePath).size
      const isTemp = /(?:^\.|\.)(?:tmp|temp|stage|staged)(?:\.|$)/i.test(entry.name)
      records.push({
        id: entry.name,
        actualBytes,
        state: isTemp ? 'temp' : 'foreign',
        source: 'filesystem',
      })
    }
    return records
  }

  private recoverAssetTrash(): void {
    const trashRoot = path.join(this.paths.root, '.trash')
    if (!fs.existsSync(trashRoot)) return
    const trashStat = fs.lstatSync(trashRoot)
    if (trashStat.isSymbolicLink() || !trashStat.isDirectory()) {
      throw new Error('附件恢复目录 .trash 必须是当前库内的普通目录')
    }
    const attachmentsStat = fs.lstatSync(this.paths.attachments)
    if (attachmentsStat.isSymbolicLink() || !attachmentsStat.isDirectory()) {
      throw new Error('附件恢复前发现 attachments 不是普通目录')
    }

    const db = this.requireDb()
    assertPortableAssetDatabaseIntegrity(db)
    const snapshot = this.loadSnapshot()
    if (snapshot) assertPortableSnapshotAssetReferences(snapshot, db)
    const portableSnapshotReferences = new Set(
      snapshot
        ? buildAssetInventory(snapshot, []).referenced.map(({ id }) => id.toLowerCase())
        : [],
    )
    for (const operation of fs.readdirSync(trashRoot, { withFileTypes: true })) {
      if (operation.isSymbolicLink() || !operation.isDirectory() || !isSafeAssetId(operation.name)) {
        throw new Error('附件恢复目录包含非法操作项，已停止打开资料库')
      }
      const operationDir = path.join(trashRoot, operation.name)
      const manifestPath = path.join(operationDir, ASSET_TRASH_MANIFEST)
      const cleanupPath = path.join(operationDir, ASSET_TRASH_CLEANUP)
      const initialNames = fs.readdirSync(operationDir)
      if (initialNames.length === 0) {
        fs.rmdirSync(operationDir)
        fsyncDirectorySync(trashRoot)
        continue
      }
      const hasManifest = fs.existsSync(manifestPath)
      const hasCleanup = fs.existsSync(cleanupPath)
      if (!hasManifest && !hasCleanup) throw new Error('附件恢复操作缺少可验证清单')
      const primary = hasManifest
        ? readAssetTrashJournal(manifestPath, operation.name)
        : readAssetTrashJournal(cleanupPath, operation.name)
      if (hasManifest && hasCleanup) {
        const cleanup = readAssetTrashJournal(cleanupPath, operation.name)
        if (JSON.stringify(primary) !== JSON.stringify(cleanup)) {
          throw new Error('附件恢复双清单内容不一致，已停止打开资料库')
        }
      }
      const manifest = primary
      const expectedNames = new Set([ASSET_TRASH_MANIFEST, ASSET_TRASH_CLEANUP])
      for (const file of manifest.files) {
        expectedNames.add(file.fileName)
      }
      const actualNames = fs.readdirSync(operationDir)
      if (
        !actualNames.includes(ASSET_TRASH_MANIFEST) && !actualNames.includes(ASSET_TRASH_CLEANUP) ||
        actualNames.some((name) => !expectedNames.has(name))
      ) {
        throw new Error('附件恢复目录内容与清单不一致')
      }

      for (const file of manifest.files) {
        const stagedPath = path.join(operationDir, file.fileName)
        const targetPath = resolveAttachmentWritePath(this.paths.attachments, file.fileName)
        const portableRecords = readPortableAssetRecords(db, file.id, file.fileName)
        if (portableRecords.length === 0 && portableSnapshotReferences.has(file.id.toLowerCase())) {
          throw new Error('附件恢复清单仍被快照引用但数据库行缺失，已保留活动与 trash 证据')
        }
        const inspectedTarget = this.inspectPortableAttachment(file.id, file.fileName)
        if (portableRecords.length > 0) {
          const record = portableRecords[0]
          if (
            portableRecords.length !== 1 ||
            record?.id !== file.id ||
            record.fileName !== file.fileName
          ) {
            throw new Error('附件恢复清单与数据库存在不可移植的路径别名')
          }
          if (inspectedTarget) {
            assertRegularFile(inspectedTarget, '活动附件')
            if (fs.existsSync(stagedPath)) {
              assertRegularFile(stagedPath, '待恢复附件副本')
              fs.rmSync(stagedPath)
              fsyncDirectorySync(operationDir)
            }
          } else if (fs.existsSync(stagedPath)) {
            assertRegularFile(stagedPath, '待恢复附件')
            fs.renameSync(stagedPath, targetPath)
            fsyncDirectorySync(this.paths.attachments)
            fsyncDirectorySync(operationDir)
          } else {
            throw new Error('附件恢复所需的活动文件与 trash 副本均不存在')
          }
        } else {
          if (inspectedTarget) {
            assertRegularFile(inspectedTarget, '待完成清理的活动附件')
            fs.rmSync(inspectedTarget)
            fsyncDirectorySync(this.paths.attachments)
          }
          if (fs.existsSync(stagedPath)) {
            assertRegularFile(stagedPath, '待完成清理附件')
            fs.rmSync(stagedPath)
            fsyncDirectorySync(operationDir)
          }
        }
      }
      if (!fs.existsSync(cleanupPath)) {
        writeFileAtomicallySync(cleanupPath, JSON.stringify(manifest, null, 2), 'utf8')
      }
      if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath)
      fsyncDirectorySync(operationDir)
      fs.rmSync(cleanupPath)
      fsyncDirectorySync(operationDir)
      // cleanup journal 消失时目录必为空；此后中断可由上方空目录分支收敛。
      fs.rmdirSync(operationDir)
      fsyncDirectorySync(trashRoot)
    }
    if (fs.readdirSync(trashRoot).length === 0) {
      fs.rmdirSync(trashRoot)
      fsyncDirectorySync(this.paths.root)
    }
  }

  previewAssetPurge(): AssetPurgePreview {
    const db = this.requireDb()
    assertPortableAssetDatabaseIntegrity(db)
    const revision = readDatabaseSnapshotRevision(db)
    const snapshot = this.loadDatabaseSnapshot(db)
    if (!snapshot) throw new Error('当前资料库尚无可校验的持久化快照')
    assertPortableSnapshotAssetReferences(snapshot, db)
    const inventory = buildAssetInventory(snapshot, this.listAssetRecords())
    return this.assetPurgePreviews.create(revision, inventory.orphan, undefined)
  }

  async prepareAssetPurgeRecovery(
    preview: AssetPurgePreview,
    selectDestination: () => Promise<string | null>,
    exportArchive: (destination: string) => Promise<{ path: string; verify: () => void }>,
  ) {
    this.assetPurgePreviews.read(preview, this.getSnapshotRevision())
    const signature = JSON.stringify(preview)
    const destination = await selectDestination()
    if (!destination) return null
    this.assetPurgePreviews.read(preview, this.getSnapshotRevision())
    const archive = await exportArchive(destination)
    const authorization = this.assetPurgePreviews.authorize(preview, this.getSnapshotRevision(), submitted => {
      if (JSON.stringify(submitted) !== signature) throw new Error('附件清理缺少与本次预览绑定的恢复归档授权')
      archive.verify()
    })
    return { authorization, path: archive.path }
  }

  async commitAssetPurge(preview: AssetPurgePreview, authorization?: string): Promise<AssetPurgeResult> {
    const prepared = this.assetPurgePreviews.take(preview, authorization)
    assertPortableAssetDatabaseIntegrity(this.requireDb())
    const files: { id: string; fileName: string; source: string }[] = []
    const candidate = this.prepareDatabaseCandidate(db => {
      if (readDatabaseSnapshotRevision(db) !== prepared.revision) {
        throw new OperationalError('asset-gc-stale-revision', '资料库在预览后已变化，请重新扫描附件')
      }
      const snapshot = this.loadDatabaseSnapshot(db)
      if (!snapshot) throw new Error('当前资料库尚无可校验的持久化快照')
      assertPortableAssetDatabaseIntegrity(db)
      assertPortableSnapshotAssetReferences(snapshot, db)
      const liveIds = new Set(buildAssetInventory(snapshot, []).referenced.map(item => item.id))
      let bytes = 0
      for (const id of prepared.candidateIds) {
        if (liveIds.has(id)) throw new OperationalError('asset-reference-missing', '清理候选已重新被笔记引用，请重新扫描')
        const fileName = readAssetFileName(db, id)
        if (!fileName || !isPortableAssetFileName(id, fileName)) throw new Error(`清理候选缺少安全数据库路径：${id}`)
        const source = this.inspectPortableAttachment(id, fileName)
        if (!source) throw new Error(`清理候选物理附件缺失：${id}`)
        bytes += assertRegularFile(source, `清理候选 ${id}`).size
        files.push({ id, fileName, source })
        db.run('DELETE FROM assets WHERE id = ?', [id])
        if (db.getRowsModified() !== 1) throw new Error(`清理候选数据库行已变化：${id}`)
      }
      if (bytes !== prepared.totalBytes) throw new Error('清理候选尺寸在预览后发生变化，请重新扫描')
      advanceSnapshotRevision(db, prepared.revision)
    })
    try {
      this.stagePurgeFiles(preview.operationId, files)
    } catch (error) {
      this.closeDetachedDatabaseBestEffort(candidate.candidateDb)
      throw error
    }
    this.commitDatabaseCandidate('asset-purge', candidate, {
      beforeReplace: this.beforeAssetAtomicReplace ?? this.beforeAtomicReplace,
      afterReplace: this.afterAssetAtomicReplace,
    })
    // 数据库决定哪些文件应删除。提交成功与重启共用清单校验及物理收尾。
    try { this.recoverAssetTrash() } catch { /* 保留清单供重新打开时继续。 */ }
    return { revision: this.getSnapshotRevision(), deletedIds: [...prepared.candidateIds] }
  }

  private stagePurgeFiles(operationId: string, files: { id: string; fileName: string; source: string }[]): void {
    this.assertAttachmentsDirectorySafe()
    const trashRoot = path.join(this.paths.root, '.trash')
    if (fs.existsSync(trashRoot)) {
      const stat = fs.lstatSync(trashRoot)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('.trash 路径不安全')
    } else {
      fs.mkdirSync(trashRoot)
      fsyncDirectorySync(this.paths.root)
    }
    const operationDir = path.join(trashRoot, operationId)
    fs.mkdirSync(operationDir)
    fsyncDirectorySync(trashRoot)
    const manifest: AssetTrashManifest = {
      version: 1,
      operationId,
      files: files.map(({ id, fileName }) => ({ id, fileName })),
    }
    writeFileAtomicallySync(
      path.join(operationDir, ASSET_TRASH_MANIFEST),
      JSON.stringify(manifest, null, 2),
      'utf8',
    )

    for (const file of files) {
      const target = path.join(operationDir, file.fileName)
      fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL)
      fsyncFileSync(target)
    }
    fsyncDirectorySync(operationDir)
  }

  clearAssetPurgePreviews(): void {
    this.assetPurgePreviews.clear()
  }

  cancelAssetPurge(operationId: string): void {
    this.assetPurgePreviews.cancel(operationId)
  }

  importAsset(id: string, mime: string, buffer: Buffer): void {
    assertSafeAssetId(id)
    const createdAt = new Date().toISOString()
    const fileName = attachmentFileName(id, importedAttachmentExtensionForMime(mime))
    const filePath = resolveAttachmentWritePath(this.paths.attachments, fileName)
    let durableRecord: ReturnType<typeof readAssetRecord> = null
    const prepared = this.prepareDatabaseCandidate((candidateDb) => {
      const portableRecords = readPortableAssetRecords(candidateDb, id, fileName)
      if (
        portableRecords.length > 1 ||
        (portableRecords[0] !== undefined && (
          portableRecords[0].id !== id || portableRecords[0].fileName !== fileName
        ))
      ) {
        throw new Error(`导入附件 ID 或文件名存在不可移植的大小写冲突：${id}`)
      }
      durableRecord = portableRecords[0]
        ? {
            mime: portableRecords[0].mime,
            fileName: portableRecords[0].fileName,
            byteSize: portableRecords[0].byteSize,
          }
        : null
      if (durableRecord && (
        durableRecord.mime !== mime ||
        durableRecord.fileName !== fileName ||
        durableRecord.byteSize !== buffer.byteLength
      )) {
        throw new Error(`导入附件 ID 或元数据冲突：${id}`)
      }
      if (!durableRecord) {
        candidateDb.run(
          `INSERT INTO assets (id, mime, file_name, byte_size, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [id, mime, fileName, buffer.byteLength, createdAt],
        )
      }
    })
    let candidateHandedOff = false
    let fileOwnedByAttempt = false
    try {
      const existingAttachment = this.inspectPortableAttachment(id, fileName)
      if (existingAttachment) {
        if (!this.readAttachmentFile(existingAttachment).equals(buffer)) {
          throw new Error(`导入附件内容冲突：${id}`)
        }
      } else {
        this.materializeAttachmentCandidate('import-asset', filePath, buffer)
        fileOwnedByAttempt = true
      }

      if (durableRecord) {
        // 同 ID、同元数据、同字节属于幂等重试；若文件此前缺失，上方只恢复文件，
        // durable DB 已经是权威真相，无需再次替换 journal.db。
        this.closeDetachedDatabaseBestEffort(prepared.candidateDb)
        return
      }

      candidateHandedOff = true
      this.commitDatabaseCandidate('import-asset', prepared, {
        beforeReplace: this.beforeAssetAtomicReplace ?? this.beforeAtomicReplace,
        afterReplace: this.afterAssetAtomicReplace,
        onPreviousUnchanged: (observedDiskBytes) => {
          if (fileOwnedByAttempt) {
            this.cleanupOwnedAttachment(observedDiskBytes, fileName, filePath, buffer)
          }
        },
      })
    } catch (error) {
      if (!candidateHandedOff) {
        this.closeDetachedDatabaseBestEffort(prepared.candidateDb)
        try {
          if (fileOwnedByAttempt) {
            this.cleanupOwnedAttachment(prepared.previousDiskBytes, fileName, filePath, buffer)
          }
        } catch (cleanupError) {
          throw this.enterStorageWriteRecoveryLock('import-asset', { error, cleanup: cleanupError })
        }
      }
      throw error
    }
  }

  /** 将导入附件与最终快照作为一次提交写入，失败时保持当前数据库不变。 */
  async commitImport(
    snapshot: PersistedSnapshot,
    assets: Array<Omit<LibraryImportAsset, 'data'> & { buffer: Buffer }>,
    options?: LibraryImportOptions & { expectedSnapshotRevision?: number },
  ): Promise<void> {
    snapshot = stripRetiredSnapshotDomains(snapshot)
    assertValidPersistedSnapshot(snapshot, 'Imported library snapshot')
    const referencedAssetIds = new Set(
      buildAssetInventory(snapshot, []).referenced.map(({ id }) => id.toLowerCase()),
    )

    // sql.js 初始化是本方法唯一的 await。之后重新从 journal.db 权威字节
    // 建 candidate，绝不持有 await 前的 active DB，也不 export 内存分叉状态。
    await getLibrarySql()
    // 初始化 SQL 会让出执行权；CAS 必须与候选创建位于同一个同步提交区间。
    type AttachmentPlan = {
      fileName: string
      filePath: string
      expectedBytes: Buffer
    }
    const materializePlans: AttachmentPlan[] = []
    const obsoletePlans: AttachmentPlan[] = []
    const batchIds = new Set<string>()
    const batchNames = new Set<string>()
    const prepared = this.prepareDatabaseCandidate((candidateDb) => {
      assertPortableAssetDatabaseIntegrity(candidateDb)
      candidateDb.run('BEGIN TRANSACTION')
      try {
        if (options?.requireEmptySnapshot) {
          const existing = candidateDb.exec('SELECT 1 FROM meta WHERE key = ?', [SNAPSHOT_KEY])
          assertEmptyMigrationTarget(existing.length > 0)
        }
        writeDatabaseSnapshot(candidateDb, snapshot, options?.expectedSnapshotRevision)
        for (const asset of assets) {
          assertSafeAssetId(asset.id)
          const inlineImage = asset.inlineImage === true
          if (inlineImage && !isImageMime(asset.mime)) throw new Error('内嵌图片 MIME 格式无效')
          const mime = inlineImage ? asset.mime.toLowerCase() : asset.mime
          const extension = inlineImage ? savedAttachmentExtensionForMime(mime) : importedAttachmentExtensionForMime(mime)
          const fileName = attachmentFileName(asset.id, extension)
          const portableId = asset.id.toLowerCase()
          const portableName = fileName.toLowerCase()
          if (batchIds.has(portableId) || batchNames.has(portableName)) {
            throw new Error(`整批导入包含重复或不可移植的附件身份：${asset.id}`)
          }
          batchIds.add(portableId)
          batchNames.add(portableName)

          const portableRecords = readPortableAssetRecords(candidateDb, asset.id, fileName)
          if (inlineImage && portableRecords.length > 0) throw new Error('附件 ID 碰撞，请重试保存')
          if (
            portableRecords.length > 1 ||
            (portableRecords[0] !== undefined && (
              portableRecords[0].id !== asset.id || portableRecords[0].fileName !== fileName
            ))
          ) {
            throw new Error(`导入附件 ID 或文件名存在不可移植的大小写冲突：${asset.id}`)
          }

          const target = resolveAttachmentWritePath(this.paths.attachments, fileName)
          const existing = this.inspectPortableAttachment(asset.id, fileName)
          if (options?.pruneUnreferenced && !referencedAssetIds.has(portableId)) {
            if (existing) {
              obsoletePlans.push({
                fileName,
                filePath: existing,
                expectedBytes: Buffer.from(this.readAttachmentFile(existing)),
              })
            }
            candidateDb.run('DELETE FROM assets WHERE id = ?', [asset.id])
            continue
          }

          const expectedBytes = Buffer.from(asset.buffer)
          if (existing) {
            if (!this.readAttachmentFile(existing).equals(expectedBytes)) {
              throw new Error(`导入附件 ID 冲突：${asset.id}`)
            }
          } else {
            materializePlans.push({ fileName, filePath: target, expectedBytes })
          }
          candidateDb.run(
            `INSERT INTO assets (id, mime, file_name, byte_size, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               mime = excluded.mime,
               file_name = excluded.file_name,
               byte_size = excluded.byte_size`,
            [asset.id, mime, fileName, expectedBytes.byteLength, this.now().toISOString()],
          )
        }
        candidateDb.run('COMMIT')
      } catch (error) {
        try { candidateDb.run('ROLLBACK') } catch { /* transaction may already be closed */ }
        throw error
      }
    })

    const ownedPlans: AttachmentPlan[] = []
    let candidateHandedOff = false
    try {
      for (const plan of materializePlans) {
        this.materializeAttachmentCandidate('import-asset', plan.filePath, plan.expectedBytes)
        ownedPlans.push(plan)
      }

      candidateHandedOff = true
      this.commitDatabaseCandidate('import-asset', prepared, {
        writeDatabase: this.writeImportDatabase,
        beforeReplace: this.beforeAssetAtomicReplace ?? this.beforeAtomicReplace,
        afterReplace: this.afterAssetAtomicReplace,
        onPreviousUnchanged: (observedDiskBytes) => {
          for (const plan of ownedPlans) {
            this.cleanupOwnedAttachment(
              observedDiskBytes,
              plan.fileName,
              plan.filePath,
              plan.expectedBytes,
            )
          }
        },
      })
    } catch (error) {
      if (!candidateHandedOff) {
        this.closeDetachedDatabaseBestEffort(prepared.candidateDb)
        if (!(error instanceof SnapshotSaveError && error.outcome === 'indeterminate')) {
          try {
            for (const plan of ownedPlans) {
              this.cleanupOwnedAttachment(
                prepared.previousDiskBytes,
                plan.fileName,
                plan.filePath,
                plan.expectedBytes,
              )
            }
          } catch (cleanupError) {
            throw this.enterStorageWriteRecoveryLock('import-asset', { error, cleanup: cleanupError })
          }
        }
      }
      throw error
    }

    // DB 已 durable 且 active 已采用 candidate。prune 的旧物理文件此时已无
    // DB 引用；收尾仍逐字节证明 preflight 所见文件未被替换。无法证明就保留
    // orphan，不能让 housekeeping 逆转已经提交的数据库事务。
    for (const plan of obsoletePlans) {
      try {
        this.cleanupOwnedAttachment(
          prepared.candidateBytes,
          plan.fileName,
          plan.filePath,
          plan.expectedBytes,
        )
      } catch {
        // 后续 inventory/再次导入可重试清理；保留比误删外部替换字节更安全。
      }
    }
  }
}

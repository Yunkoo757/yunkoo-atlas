import fs from 'node:fs'
import path from 'node:path'
import electronRuntime from 'electron'
import initSqlJs, { type Database } from 'sql.js'
import { randomUUID } from 'node:crypto'
import type { LibraryManifest, PersistedSnapshot } from '../../src/storage/types'
import type {
  AssetPurgePreview,
  AssetPurgeResult,
  PhysicalAssetRecord,
} from '../../src/storage/adapter'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { assertValidPersistedSnapshot } from '../../src/storage/snapshotValidation'
import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { ensureLibraryDirs, findAttachmentFile, getLibraryPath, getLibraryPaths } from './paths'
import { isImageMime, processImageBuffer } from './images'
import { fsyncDirectorySync, writeFileAtomicallySync } from './atomicFile'
import { assertSafeAssetId, isSafeAssetId } from '../../src/storage/assetId'
import { buildAssetInventory } from '../../src/storage/assetInventory'
import { OperationalError } from '../../src/lib/operationalError'

const SNAPSHOT_KEY = 'snapshot'
const ASSET_TRASH_MANIFEST = 'manifest.json'
const ASSET_TRASH_CLEANUP = 'cleanup.json'

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

function readAssetFileName(db: Database, id: string): string | null {
  const stmt = db.prepare('SELECT file_name FROM assets WHERE id = ?')
  try {
    stmt.bind([id])
    return stmt.step() ? String(stmt.getAsObject().file_name) : null
  } finally {
    stmt.free()
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
      path.basename(file.fileName) !== file.fileName ||
      !file.fileName.startsWith(`${file.id}.`) ||
      seenIds.has(file.id) ||
      seenNames.has(file.fileName)
    ) {
      throw new Error('附件恢复清单包含非法或重复路径')
    }
    seenIds.add(file.id)
    seenNames.add(file.fileName)
  }
  return manifest
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

export class LibraryStorage {
  private db: Database | null = null
  private paths: ReturnType<typeof ensureLibraryDirs>
  private readonly allowCreate: boolean
  private readonly writeImportDatabase: typeof writeFileAtomicallySync
  private readonly beforeAtomicReplace?: (temporaryPath: string) => void
  private assetPurgePreviews = new Map<string, {
    snapshotJson: string
    candidateIds: string[]
    totalBytes: number
  }>()

  constructor(
    libraryPath = getLibraryPath(),
    options: {
      ensureDirectories?: boolean
      allowCreate?: boolean
      writeImportDatabase?: typeof writeFileAtomicallySync
      beforeAtomicReplace?: (temporaryPath: string) => void
    } = {},
  ) {
    const resolved = path.resolve(libraryPath)
    this.allowCreate = options.allowCreate !== false
    this.writeImportDatabase = options.writeImportDatabase ?? writeFileAtomicallySync
    this.beforeAtomicReplace = options.beforeAtomicReplace
    this.paths = options.ensureDirectories === false
      ? getLibraryPaths(resolved)
      : ensureLibraryDirs(resolved)
  }

  getLibraryPath(): string {
    return this.paths.root
  }

  getPaths() {
    return this.paths
  }

  async open(): Promise<void> {
    if (this.db) return
    if (!this.allowCreate && !fs.existsSync(this.paths.manifestFile)) {
      throw new Error('manifest.json 不存在，已阻止生成新的资料库身份')
    }
    const SQL = await getSql()
    const created = !fs.existsSync(this.paths.dbFile)

    if (created && !this.allowCreate) {
      throw new Error('journal.db 不存在，已阻止创建空交易库')
    }

    // journal.db 缺失但目录已有 manifest：禁止静默建空库，以免覆盖现有记录。
    if (created && fs.existsSync(this.paths.manifestFile)) {
      throw new Error(
        'journal.db 缺失，但本目录已有资料库清单（manifest.json）。' +
          '请从设置 → 数据 → 备份中恢复，或重新选择正确的资料库目录。' +
          '已阻止写入空库，以免覆盖现有记录。',
      )
    }

    if (created) {
      this.db = new SQL.Database()
    } else {
      const file = fs.readFileSync(this.paths.dbFile)
      this.db = new SQL.Database(file)
    }

    if (!this.allowCreate) {
      const tables = this.db.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'assets')",
      )
      const names = new Set((tables[0]?.values ?? []).map((row) => String(row[0])))
      if (!names.has('meta') || !names.has('assets')) {
        throw new Error('journal.db 缺少必需的数据表，已阻止按空交易库打开')
      }
      const requiredColumns: Record<string, string[]> = {
        meta: ['key', 'value'],
        assets: ['id', 'mime', 'file_name', 'byte_size', 'created_at'],
      }
      for (const [table, required] of Object.entries(requiredColumns)) {
        const columns = new Set(
          (this.db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? [])
            .map((row) => String(row[1])),
        )
        if (required.some((column) => !columns.has(column))) {
          throw new Error(`journal.db 的 ${table} 表结构不完整，已阻止按空交易库打开`)
        }
      }
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
    `)

    if (this.allowCreate && (created || !fs.existsSync(this.paths.manifestFile))) {
      this.writeManifest({
        schemaVersion: SCHEMA_VERSION,
        libraryId: randomUUID(),
        createdAt: new Date().toISOString(),
        platform: 'electron',
      })
    }

    // 仅新建库时落盘，避免每次打开都无意义地重写磁盘文件。
    if (created) {
      this.persistDb()
    }
    this.recoverAssetTrash()
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.assetPurgePreviews.clear()
  }

  /** Close db without a final export; mutations already persist at write time. */
  release(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.assetPurgePreviews.clear()
  }

  private requireDb(): Database {
    if (!this.db) throw new Error('Library database not opened')
    return this.db
  }

  private persistDb(): void {
    if (!this.db) return
    const data = this.db.export()
    writeFileAtomicallySync(this.paths.dbFile, Buffer.from(data), undefined, this.beforeAtomicReplace)
  }

  readManifest(): LibraryManifest {
    if (!fs.existsSync(this.paths.manifestFile)) {
      if (!this.allowCreate) {
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
    return JSON.parse(fs.readFileSync(this.paths.manifestFile, 'utf8')) as LibraryManifest
  }

  writeManifest(manifest: LibraryManifest): void {
    writeFileAtomicallySync(
      this.paths.manifestFile,
      JSON.stringify(manifest, null, 2),
      'utf8',
    )
  }

  private readSnapshotJson(): string | null {
    const db = this.requireDb()
    const stmt = db.prepare('SELECT value FROM meta WHERE key = ?')
    stmt.bind([SNAPSHOT_KEY])
    if (!stmt.step()) {
      stmt.free()
      return null
    }
    const value = String(stmt.getAsObject().value)
    stmt.free()
    return value
  }

  loadSnapshot(): PersistedSnapshot | null {
    const value = this.readSnapshotJson()
    if (value === null) return null
    const snapshot: unknown = JSON.parse(value)
    return decodeCanonicalSnapshot(snapshot, {
      version: this.readManifest().schemaVersion,
      label: 'Stored library snapshot',
    })
  }

  saveSnapshot(snapshot: PersistedSnapshot): void {
    assertValidPersistedSnapshot(snapshot, 'Library snapshot')
    const db = this.requireDb()
    db.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SNAPSHOT_KEY, JSON.stringify(snapshot)],
    )
    this.persistDb()
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
  /** 备份与校验只认数据库已声明附件，忽略磁盘上尚未收尾的孤儿文件。 */
  listCommittedAttachmentFileNames(): string[] {
    const db = this.requireDb()
    const result = db.exec('SELECT file_name FROM assets ORDER BY file_name')
    return (result[0]?.values ?? []).map((row) => String(row[0]))
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

  listAssetRecords(): PhysicalAssetRecord[] {
    const db = this.requireDb()
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
      const legalName = path.basename(fileName) === fileName && fileName.startsWith(`${id}.`)
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
        const rowFileName = readAssetFileName(db, file.id)
        if (rowFileName !== null) {
          if (rowFileName !== file.fileName) throw new Error('附件恢复清单与数据库路径不一致')
          if (fs.existsSync(targetPath)) {
            assertRegularFile(targetPath, '活动附件')
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
          if (fs.existsSync(targetPath)) {
            assertRegularFile(targetPath, '待完成清理的活动附件')
            fs.rmSync(targetPath)
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
    const snapshotJson = this.readSnapshotJson()
    if (snapshotJson === null) throw new Error('当前资料库尚无可校验的持久化快照')
    const snapshot = this.loadSnapshot()!
    const inventory = buildAssetInventory(snapshot, this.listAssetRecords())
    const candidateIds = inventory.orphan.map((record) => record.id).sort()
    const totalBytes = inventory.orphan.reduce(
      (sum, record) => sum + (record.actualBytes ?? 0),
      0,
    )
    const operationId = randomUUID()
    this.assetPurgePreviews.set(operationId, { snapshotJson, candidateIds, totalBytes })
    return { operationId, revision: 0, candidateIds: [...candidateIds], totalBytes }
  }

  async commitAssetPurge(preview: AssetPurgePreview): Promise<AssetPurgeResult> {
    const prepared = this.assetPurgePreviews.get(preview.operationId)
    this.assetPurgePreviews.delete(preview.operationId)
    if (
      !prepared ||
      preview.revision !== 0 ||
      prepared.candidateIds.join('\0') !== preview.candidateIds.join('\0') ||
      prepared.totalBytes !== preview.totalBytes
    ) {
      throw new OperationalError('asset-gc-stale-revision', '附件清理预览无效或已使用，请重新扫描')
    }
    if (this.readSnapshotJson() !== prepared.snapshotJson) {
      throw new OperationalError('asset-gc-stale-revision', '资料库在预览后已变化，请重新扫描附件')
    }
    const currentSnapshot = this.loadSnapshot()!
    const liveIds = new Set(
      buildAssetInventory(currentSnapshot, []).referenced.map((item) => item.id),
    )
    if (prepared.candidateIds.some((id) => liveIds.has(id))) {
      throw new OperationalError('asset-reference-missing', '清理候选已重新被笔记引用，请重新扫描')
    }

    const attachmentsStat = fs.lstatSync(this.paths.attachments)
    if (attachmentsStat.isSymbolicLink() || !attachmentsStat.isDirectory()) {
      throw new Error('attachments 路径不是当前库内的普通目录')
    }

    const currentDb = this.requireDb()
    const files = prepared.candidateIds.map((id) => {
      const fileName = readAssetFileName(currentDb, id)
      if (!fileName || path.basename(fileName) !== fileName || !fileName.startsWith(`${id}.`)) {
        throw new Error(`清理候选缺少安全数据库路径：${id}`)
      }
      const source = resolveAttachmentWritePath(this.paths.attachments, fileName)
      const stat = assertRegularFile(source, `清理候选 ${id}`)
      return { id, fileName, bytes: stat.size, source }
    })
    if (files.reduce((sum, file) => sum + file.bytes, 0) !== prepared.totalBytes) {
      throw new Error('清理候选尺寸在预览后发生变化，请重新扫描')
    }

    const trashRoot = path.join(this.paths.root, '.trash')
    if (fs.existsSync(trashRoot)) {
      const stat = fs.lstatSync(trashRoot)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('.trash 路径不安全')
    } else {
      fs.mkdirSync(trashRoot)
      fsyncDirectorySync(this.paths.root)
    }
    const operationDir = path.join(trashRoot, preview.operationId)
    fs.mkdirSync(operationDir)
    fsyncDirectorySync(trashRoot)
    const manifest: AssetTrashManifest = {
      version: 1,
      operationId: preview.operationId,
      files: files.map(({ id, fileName }) => ({ id, fileName })),
    }
    writeFileAtomicallySync(
      path.join(operationDir, ASSET_TRASH_MANIFEST),
      JSON.stringify(manifest, null, 2),
      'utf8',
    )

    const staged: typeof files = []
    // 仅当 DB 已原子落盘但本轮物理收尾无法完成时才延迟；不再因 Windows 一律跳过，
    // 否则同一会话内备份会把仍留在 attachments/ 的孤儿文件打进去并验证失败。
    let cleanupDeferred = false
    let nextDb: Database | null = null
    try {
      for (const file of files) {
        const target = path.join(operationDir, file.fileName)
        fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL)
        const descriptor = fs.openSync(target, 'r+')
        try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
        staged.push(file)
      }
      fsyncDirectorySync(operationDir)
      const SQL = await getSql()
      nextDb = new SQL.Database(currentDb.export())
      nextDb.run('BEGIN TRANSACTION')
      for (const id of prepared.candidateIds) {
        nextDb.run('DELETE FROM assets WHERE id = ?', [id])
        if (nextDb.getRowsModified() !== 1) throw new Error(`清理候选数据库行已变化：${id}`)
      }
      nextDb.run('COMMIT')
      const nextDbBytes = Buffer.from(nextDb.export())
      try {
        writeFileAtomicallySync(this.paths.dbFile, nextDbBytes)
      } catch (error) {
        // 目录屏障发生在原子替换之后；此时抛错不代表磁盘仍是旧库。
        // 若目标文件已经完整等于新库，则必须按已提交处理，避免把附件搬回
        // 一个已删除对应 assets 行的数据库。trash 会保留给启动恢复收尾。
        let replaced = false
        try { replaced = fs.readFileSync(this.paths.dbFile).equals(nextDbBytes) } catch { /* 未替换 */ }
        if (!replaced) throw error
        cleanupDeferred = true
      }
      this.db = nextDb
      nextDb = null
      try { currentDb.close() } catch { /* 新数据库已经耐久落盘。 */ }
    } catch (error) {
      try { nextDb?.run('ROLLBACK') } catch { /* transaction may already be closed */ }
      try { nextDb?.close() } catch { /* ignore */ }
      // DB 前失败时活动原件从未移动。保留完整 manifest + staged 副本，
      // 由启动恢复按旧 DB 行安全清理，避免递归删除中断留下无 journal 文件。
      throw error
    }

    if (!cleanupDeferred) {
      try {
        writeFileAtomicallySync(
          path.join(operationDir, ASSET_TRASH_CLEANUP),
          JSON.stringify(manifest, null, 2),
          'utf8',
        )
        for (const file of staged) fs.rmSync(file.source)
        fsyncDirectorySync(this.paths.attachments)
        for (const file of staged) {
          const stagedPath = path.join(operationDir, file.fileName)
          if (fs.existsSync(stagedPath)) fs.rmSync(stagedPath)
        }
        fsyncDirectorySync(operationDir)
        const manifestPath = path.join(operationDir, ASSET_TRASH_MANIFEST)
        if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath)
        fsyncDirectorySync(operationDir)
        fs.rmSync(path.join(operationDir, ASSET_TRASH_CLEANUP))
        fsyncDirectorySync(operationDir)
        fs.rmdirSync(operationDir)
        fsyncDirectorySync(trashRoot)
      } catch {
        cleanupDeferred = true /* 启动恢复会完成已提交清理。 */
      }
    }
    if (cleanupDeferred) {
      try {
        this.recoverAssetTrash()
      } catch { /* 保留 trash；下次打开资料库再收敛。 */ }
    }
    try {
      if (fs.existsSync(trashRoot) && fs.readdirSync(trashRoot).length === 0) {
        fs.rmdirSync(trashRoot)
        fsyncDirectorySync(this.paths.root)
      }
    } catch { /* 保留空目录不影响正确性。 */ }
    return { revision: 0, deletedIds: [...prepared.candidateIds] }
  }

  cancelAssetPurge(operationId: string): void {
    this.assetPurgePreviews.delete(operationId)
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
    for (const review of snapshot.weeklyReviews ?? []) {
      const re = /journal-asset:\/\/([^"'\s>]+)/g
      let match: RegExpExecArray | null
      while ((match = re.exec(review.contentHtml)) !== null) referencedAssetIds.add(match[1])
    }
    for (const note of snapshot.quickNotes ?? []) {
      const re = /journal-asset:\/\/([^"'\s>]+)/g
      let match: RegExpExecArray | null
      while ((match = re.exec(note.contentHtml)) !== null) referencedAssetIds.add(match[1])
    }
    const obsoleteImportedFiles: string[] = []
    let adopted = false

    try {
      nextDb.run('BEGIN TRANSACTION')
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
      const nextDbBytes = Buffer.from(nextDb.export())
      try {
        this.writeImportDatabase(this.paths.dbFile, nextDbBytes)
      } catch (error) {
        const targetWasReplaced = fs.existsSync(this.paths.dbFile) && fs.readFileSync(this.paths.dbFile).equals(nextDbBytes)
        if (!targetWasReplaced) throw error
        // rename 已提交、仅后续目录 durability barrier 报错时，不得删除新 DB 正在引用的附件。
      }
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

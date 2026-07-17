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

const SNAPSHOT_KEY = 'snapshot'

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
    const created = !fs.existsSync(this.paths.dbFile)

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

    if (created || !fs.existsSync(this.paths.manifestFile)) {
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

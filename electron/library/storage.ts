import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import initSqlJs, { type Database } from 'sql.js'
import { randomUUID } from 'node:crypto'
import type { LibraryManifest, PersistedSnapshot } from '../../src/storage/types'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { ensureLibraryDirs, findAttachmentFile, getLibraryPath } from './paths'
import { isImageMime, processImageBuffer } from './images'

const SNAPSHOT_KEY = 'snapshot'

export interface AssetBytes {
  id: string
  mime: string
  bytes: Uint8Array
}

let sqlPromise: ReturnType<typeof initSqlJs> | null = null

async function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => {
        const candidates = [
          path.join(app.getAppPath(), 'dist-electron', file),
          path.join(app.getAppPath(), file),
          path.join(process.cwd(), 'dist-electron', file),
          path.join(process.cwd(), 'node_modules/sql.js/dist', file),
        ]
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
  private paths = ensureLibraryDirs(getLibraryPath())

  getLibraryPath(): string {
    return this.paths.root
  }

  getPaths() {
    return this.paths
  }

  async open(): Promise<void> {
    if (this.db) return
    this.paths = ensureLibraryDirs(getLibraryPath())
    const SQL = await getSql()
    const created = !fs.existsSync(this.paths.dbFile)

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

    this.persistDb()
  }

  close(): void {
    if (this.db) {
      this.persistDb()
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
    fs.writeFileSync(this.paths.dbFile, Buffer.from(data))
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
    fs.writeFileSync(this.paths.manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
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
    return JSON.parse(value) as PersistedSnapshot
  }

  saveSnapshot(snapshot: PersistedSnapshot): void {
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
    const filePath = path.join(this.paths.attachments, fileName)
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

  importAsset(id: string, mime: string, buffer: Buffer): void {
    const db = this.requireDb()
    const createdAt = new Date().toISOString()
    const ext = mime.includes('webp')
      ? 'webp'
      : mime.includes('png')
        ? 'png'
        : mime.includes('jpeg') || mime.includes('jpg')
          ? 'jpg'
          : 'bin'
    const fileName = `${id}.${ext}`
    const filePath = path.join(this.paths.attachments, fileName)
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
}

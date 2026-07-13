import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { ZipArchive } from 'archiver'
import extract from 'extract-zip'
import initSqlJs from 'sql.js'
import type { LibraryStorage } from './storage'
import { ensureLibraryDirs } from './paths'
import {
  SCHEMA_VERSION,
  type ExportAssetRecord,
  type PersistedSnapshot,
} from '../../src/storage/types'

export async function exportJournalZip(
  storage: LibraryStorage,
  destinationFile: string,
): Promise<void> {
  const paths = storage.getPaths()
  fs.mkdirSync(path.dirname(destinationFile), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destinationFile)
    const archive = new ZipArchive({ zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)

    archive.file(paths.manifestFile, { name: 'manifest.json' })
    archive.file(paths.dbFile, { name: 'journal.db' })

    if (fs.existsSync(paths.attachments)) {
      archive.directory(paths.attachments, 'attachments')
    }

    void archive.finalize()
  })
}

function locateSqlWasm(file: string): string {
  const candidates = [
    path.join(app.getAppPath(), 'dist-electron', file),
    path.join(app.getAppPath(), file),
    path.join(process.resourcesPath ?? '', file),
    path.join(process.cwd(), 'dist-electron', file),
    path.join(process.cwd(), 'node_modules/sql.js/dist', file),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return path.join(process.cwd(), 'node_modules/sql.js/dist', file)
}

function clearDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    return
  }
  for (const name of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true })
  }
}

async function extractZipToDir(zipFile: string, destinationDir: string): Promise<void> {
  const libraryRoot = path.dirname(destinationDir)
  const zipPath = path.resolve(zipFile).toLowerCase()
  const libraryPath = path.resolve(libraryRoot).toLowerCase()
  const zipInsideLibrary = zipPath.startsWith(libraryPath + path.sep)

  if (process.platform === 'win32' && !zipInsideLibrary) {
    const { execFileSync } = await import('node:child_process')
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '$ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath $env:LINEAR_JOURNAL_ZIP_FILE -DestinationPath $env:LINEAR_JOURNAL_ZIP_DEST -Force',
      ],
      {
        env: {
          ...process.env,
          LINEAR_JOURNAL_ZIP_FILE: zipFile,
          LINEAR_JOURNAL_ZIP_DEST: destinationDir,
        },
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      },
    )
    return
  }

  await extract(zipFile, { dir: destinationDir })
}

function mimeToExt(mime: string): string {
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('svg')) return 'svg'
  if (mime.includes('bmp')) return 'bmp'
  return 'bin'
}

function findWebAssetFile(assetsDir: string, id: string): string | null {
  if (!fs.existsSync(assetsDir)) return null
  for (const name of fs.readdirSync(assetsDir)) {
    if (name.startsWith(`${id}.`)) return path.join(assetsDir, name)
  }
  return null
}

function readWebSnapshot(dataFile: string): {
  snapshot: PersistedSnapshot
  assets: Pick<ExportAssetRecord, 'id' | 'mime'>[]
} {
  const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8')) as Partial<PersistedSnapshot> & {
    assets?: Pick<ExportAssetRecord, 'id' | 'mime'>[]
  }
  if (!Array.isArray(raw.trades) || !Array.isArray(raw.strategies)) {
    throw new Error('Invalid .journal.zip: data.json is missing trades or strategies')
  }
  return {
    snapshot: {
      trades: raw.trades,
      strategies: raw.strategies,
      starredIds: raw.starredIds ?? [],
      subscribedIds: raw.subscribedIds ?? [],
      pinnedStrategyIds: raw.pinnedStrategyIds ?? [],
      display: raw.display,
      tagPresets: raw.tagPresets ?? [],
      mistakeTagPresets: raw.mistakeTagPresets ?? [],
      shortcuts: raw.shortcuts,
      profile: raw.profile,
      savedTradeViews: raw.savedTradeViews ?? [],
      symbolIcons: raw.symbolIcons ?? {},
      symbolCatalog: raw.symbolCatalog ?? [],
    } as PersistedSnapshot,
    assets: Array.isArray(raw.assets)
      ? raw.assets.filter((asset) => typeof asset.id === 'string' && typeof asset.mime === 'string')
      : [],
  }
}

function writeImportProgress(message: string): void {
  const progressPath = process.env.LINEAR_JOURNAL_QA_PROGRESS
  if (!progressPath) return
  fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`, 'utf8')
}

async function importWebJournalZip(
  paths: ReturnType<typeof ensureLibraryDirs>,
  tempDir: string,
): Promise<void> {
  const dataSrc = path.join(tempDir, 'data.json')
  const assetsSrc = path.join(tempDir, 'assets')
  const { snapshot, assets } = readWebSnapshot(dataSrc)
  const SQL = await initSqlJs({ locateFile: locateSqlWasm })
  const db = new SQL.Database()

  db.run(`
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
  db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [
    'snapshot',
    JSON.stringify(snapshot),
  ])

  clearDirectory(paths.attachments)
  const createdAt = new Date().toISOString()
  for (const asset of assets) {
    const src = findWebAssetFile(assetsSrc, asset.id)
    if (!src) continue
    const ext = path.extname(src).slice(1) || mimeToExt(asset.mime)
    const fileName = `${asset.id}.${ext}`
    const dest = path.join(paths.attachments, fileName)
    fs.copyFileSync(src, dest)
    db.run(
      `INSERT INTO assets (id, mime, file_name, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [asset.id, asset.mime, fileName, fs.statSync(dest).size, createdAt],
    )
  }

  fs.writeFileSync(paths.dbFile, Buffer.from(db.export()))
  db.close()
  fs.writeFileSync(
    paths.manifestFile,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      libraryId: randomUUID(),
      createdAt,
      platform: 'electron',
    }, null, 2),
    'utf8',
  )
}

function backupCurrentLibrary(paths: ReturnType<typeof ensureLibraryDirs>, backupDir: string): void {
  if (fs.existsSync(paths.manifestFile)) {
    fs.copyFileSync(paths.manifestFile, path.join(backupDir, 'manifest.json'))
  }
  if (fs.existsSync(paths.dbFile)) {
    fs.copyFileSync(paths.dbFile, path.join(backupDir, 'journal.db'))
  }
  if (fs.existsSync(paths.attachments)) {
    for (const name of fs.readdirSync(paths.attachments)) {
      fs.copyFileSync(path.join(paths.attachments, name), path.join(backupDir, name))
    }
  }
}

function restoreCurrentLibrary(paths: ReturnType<typeof ensureLibraryDirs>, backupDir: string): void {
  const manifestBackup = path.join(backupDir, 'manifest.json')
  const dbBackup = path.join(backupDir, 'journal.db')
  if (fs.existsSync(manifestBackup)) {
    fs.copyFileSync(manifestBackup, paths.manifestFile)
  }
  if (fs.existsSync(dbBackup)) {
    fs.copyFileSync(dbBackup, paths.dbFile)
  }

  clearDirectory(paths.attachments)
  for (const name of fs.readdirSync(backupDir)) {
    if (name === 'manifest.json' || name === 'journal.db') continue
    fs.copyFileSync(path.join(backupDir, name), path.join(paths.attachments, name))
  }
}

export async function importJournalZipToPath(
  libraryRoot: string,
  zipFile: string,
): Promise<void> {
  const paths = ensureLibraryDirs(libraryRoot)
  const tempDir = path.join(libraryRoot, `.import-${Date.now()}`)
  const preImportBackup = path.join(libraryRoot, `.pre-import-${Date.now()}`)
  fs.mkdirSync(tempDir, { recursive: true })
  fs.mkdirSync(preImportBackup, { recursive: true })

  try {
    writeImportProgress('importZip: backup current library start')
    backupCurrentLibrary(paths, preImportBackup)
    writeImportProgress('importZip: backup current library done')
    writeImportProgress('importZip: extract start')
    await extractZipToDir(zipFile, tempDir)
    writeImportProgress('importZip: extract done')

    const manifestSrc = path.join(tempDir, 'manifest.json')
    const dbSrc = path.join(tempDir, 'journal.db')
    const dataSrc = path.join(tempDir, 'data.json')
    const attachmentsSrc = path.join(tempDir, 'attachments')

    if (fs.existsSync(manifestSrc) && fs.existsSync(dbSrc)) {
      writeImportProgress('importZip: manifest/db branch start')
      fs.copyFileSync(manifestSrc, paths.manifestFile)
      writeImportProgress('importZip: manifest copied')
      fs.copyFileSync(dbSrc, paths.dbFile)
      writeImportProgress('importZip: db copied')

      if (fs.existsSync(attachmentsSrc)) {
        writeImportProgress('importZip: clear attachments start')
        clearDirectory(paths.attachments)
        writeImportProgress('importZip: clear attachments done')
        for (const name of fs.readdirSync(attachmentsSrc)) {
          writeImportProgress(`importZip: copy attachment ${name} start`)
          fs.copyFileSync(path.join(attachmentsSrc, name), path.join(paths.attachments, name))
          writeImportProgress(`importZip: copy attachment ${name} done`)
        }
      }
      writeImportProgress('importZip: manifest/db branch done')
    } else if (fs.existsSync(dataSrc)) {
      writeImportProgress('importZip: data.json branch start')
      await importWebJournalZip(paths, tempDir)
      writeImportProgress('importZip: data.json branch done')
    } else {
      throw new Error('Invalid .journal.zip: missing manifest.json/journal.db or data.json')
    }
  } catch (err) {
    writeImportProgress(`importZip: error ${err instanceof Error ? err.message : String(err)}`)
    restoreCurrentLibrary(paths, preImportBackup)
    throw err
  } finally {
    writeImportProgress('importZip: cleanup start')
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(preImportBackup, { recursive: true, force: true })
    writeImportProgress('importZip: cleanup done')
  }
}

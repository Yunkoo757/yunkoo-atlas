import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { ZipArchive } from 'archiver'
import extract from 'extract-zip'
import initSqlJs from 'sql.js'
import type { LibraryStorage } from './storage'
import { ensureLibraryDirs } from './paths'
import { writeFileAtomicallySync } from './atomicFile'
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

function validateManifest(manifestFile: string): void {
  let manifest: unknown
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  } catch {
    throw new Error('Invalid .journal.zip: manifest.json is not valid JSON')
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    typeof (manifest as { schemaVersion?: unknown }).schemaVersion !== 'number' ||
    typeof (manifest as { libraryId?: unknown }).libraryId !== 'string'
  ) {
    throw new Error('Invalid .journal.zip: manifest.json is missing required library fields')
  }
}

async function validateDesktopLibrary(
  paths: ReturnType<typeof ensureLibraryDirs>,
): Promise<void> {
  validateManifest(paths.manifestFile)
  const SQL = await initSqlJs({ locateFile: locateSqlWasm })
  let db: InstanceType<typeof SQL.Database> | null = null
  try {
    db = new SQL.Database(fs.readFileSync(paths.dbFile))
    const tables = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'assets')",
    )
    const names = new Set((tables[0]?.values ?? []).map((row) => String(row[0])))
    if (!names.has('meta') || !names.has('assets')) {
      throw new Error('database is missing required tables')
    }

    const snapshotRows = db.exec("SELECT value FROM meta WHERE key = 'snapshot'")
    const snapshotText = snapshotRows[0]?.values[0]?.[0]
    if (snapshotText != null) {
      const snapshot = JSON.parse(String(snapshotText)) as Partial<PersistedSnapshot>
      if (!Array.isArray(snapshot.trades) || !Array.isArray(snapshot.strategies)) {
        throw new Error('snapshot is missing trades or strategies')
      }
    }

    const assets = db.exec('SELECT file_name FROM assets')
    for (const row of assets[0]?.values ?? []) {
      const fileName = String(row[0] ?? '')
      if (!fileName || path.basename(fileName) !== fileName) {
        throw new Error('asset metadata contains an unsafe file path')
      }
    }
  } catch (err) {
    throw new Error(
      `Invalid .journal.zip: journal.db could not be validated (${err instanceof Error ? err.message : String(err)})`,
    )
  } finally {
    db?.close()
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

  writeFileAtomicallySync(paths.dbFile, Buffer.from(db.export()))
  db.close()
  writeFileAtomicallySync(
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

function copyAttachmentFiles(source: string, destination: string): void {
  clearDirectory(destination)
  if (!fs.existsSync(source)) return
  for (const name of fs.readdirSync(source)) {
    const sourceFile = path.join(source, name)
    if (!fs.statSync(sourceFile).isFile()) continue
    fs.copyFileSync(sourceFile, path.join(destination, name))
  }
}

function backupCurrentLibrary(paths: ReturnType<typeof ensureLibraryDirs>, backupDir: string): void {
  if (fs.existsSync(paths.manifestFile)) {
    fs.copyFileSync(paths.manifestFile, path.join(backupDir, 'manifest.json'))
  }
  if (fs.existsSync(paths.dbFile)) {
    fs.copyFileSync(paths.dbFile, path.join(backupDir, 'journal.db'))
  }
  if (fs.existsSync(paths.attachments)) {
    copyAttachmentFiles(paths.attachments, path.join(backupDir, 'attachments'))
  }
}

function restoreCurrentLibrary(paths: ReturnType<typeof ensureLibraryDirs>, backupDir: string): void {
  const manifestBackup = path.join(backupDir, 'manifest.json')
  const dbBackup = path.join(backupDir, 'journal.db')
  fs.rmSync(paths.manifestFile, { force: true })
  fs.rmSync(paths.dbFile, { force: true })
  if (fs.existsSync(manifestBackup)) {
    writeFileAtomicallySync(paths.manifestFile, fs.readFileSync(manifestBackup))
  }
  if (fs.existsSync(dbBackup)) {
    writeFileAtomicallySync(paths.dbFile, fs.readFileSync(dbBackup))
  }
  copyAttachmentFiles(path.join(backupDir, 'attachments'), paths.attachments)
}

export async function importJournalZipToPath(
  libraryRoot: string,
  zipFile: string,
): Promise<void> {
  const paths = ensureLibraryDirs(libraryRoot)
  const tempDir = path.join(libraryRoot, `.import-${Date.now()}`)
  const preImportBackup = path.join(libraryRoot, `.pre-import-${Date.now()}`)
  const preparedRoot = path.join(tempDir, 'prepared')
  fs.mkdirSync(tempDir, { recursive: true })
  let mutationStarted = false
  let keepRecoveryBackup = false

  try {
    writeImportProgress('importZip: extract start')
    await extractZipToDir(zipFile, tempDir)
    writeImportProgress('importZip: extract done')

    const manifestSrc = path.join(tempDir, 'manifest.json')
    const dbSrc = path.join(tempDir, 'journal.db')
    const dataSrc = path.join(tempDir, 'data.json')
    const attachmentsSrc = path.join(tempDir, 'attachments')
    const preparedPaths = ensureLibraryDirs(preparedRoot)

    if (fs.existsSync(manifestSrc) && fs.existsSync(dbSrc)) {
      fs.copyFileSync(manifestSrc, preparedPaths.manifestFile)
      fs.copyFileSync(dbSrc, preparedPaths.dbFile)
      copyAttachmentFiles(attachmentsSrc, preparedPaths.attachments)
    } else if (fs.existsSync(dataSrc)) {
      await importWebJournalZip(preparedPaths, tempDir)
    } else {
      throw new Error('Invalid .journal.zip: missing manifest.json/journal.db or data.json')
    }

    writeImportProgress('importZip: validate prepared library start')
    await validateDesktopLibrary(preparedPaths)
    writeImportProgress('importZip: validate prepared library done')

    fs.mkdirSync(preImportBackup, { recursive: true })
    writeImportProgress('importZip: backup current library start')
    backupCurrentLibrary(paths, preImportBackup)
    writeImportProgress('importZip: backup current library done')

    mutationStarted = true
    writeFileAtomicallySync(paths.manifestFile, fs.readFileSync(preparedPaths.manifestFile))
    writeFileAtomicallySync(paths.dbFile, fs.readFileSync(preparedPaths.dbFile))
    copyAttachmentFiles(preparedPaths.attachments, paths.attachments)
  } catch (err) {
    writeImportProgress(`importZip: error ${err instanceof Error ? err.message : String(err)}`)
    if (mutationStarted) {
      try {
        restoreCurrentLibrary(paths, preImportBackup)
      } catch (restoreErr) {
        keepRecoveryBackup = true
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}; ` +
            `恢复当前交易库失败，安全副本已保留在 ${preImportBackup}: ` +
            `${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
        )
      }
    }
    throw err
  } finally {
    writeImportProgress('importZip: cleanup start')
    fs.rmSync(tempDir, { recursive: true, force: true })
    if (!keepRecoveryBackup) {
      fs.rmSync(preImportBackup, { recursive: true, force: true })
    }
    writeImportProgress('importZip: cleanup done')
  }
}

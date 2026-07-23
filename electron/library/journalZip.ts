import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ZipArchive } from 'archiver'
import initSqlJs from 'sql.js'
import * as yauzl from 'yauzl'
import type { LibraryStorage } from './storage'
import { ensureLibraryDirs } from './paths'
import { writeFileAtomicallySync } from './atomicFile'
import {
  SCHEMA_VERSION,
  type LibraryManifest,
  type PersistedSnapshot,
} from '../../src/storage/types'
import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { isSafeAssetId } from '../../src/storage/assetId'
import {
  WEB_JOURNAL_EXPORT_VERSION,
  normalizeWebJournalImageMime,
  webJournalExtensionsForMime,
} from '../../src/lib/webJournalArchiveContract'

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
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  const candidates = [
    ...(resourcesPath
      ? [
          path.join(resourcesPath, file),
          path.join(resourcesPath, 'app.asar', 'dist-electron', file),
          path.join(resourcesPath, 'app', 'dist-electron', file),
        ]
      : []),
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

export const MAX_DESKTOP_JOURNAL_ARCHIVE_BYTES = 1024 * 1024 * 1024
export const MAX_DESKTOP_JOURNAL_ENTRY_COUNT = 20_000
export const MAX_DESKTOP_JOURNAL_ENTRY_BYTES = 256 * 1024 * 1024
export const MAX_DESKTOP_JOURNAL_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
const DESKTOP_JOURNAL_EXTRACTION_TIMEOUT_MS = 5 * 60_000

export interface JournalZipEntryLimits {
  maxEntryCount: number
  maxEntryBytes: number
  maxExpandedBytes: number
}

interface JournalZipEntryMetadata {
  fileName: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
  generalPurposeBitFlag: number
  externalFileAttributes: number
}

const DEFAULT_JOURNAL_ZIP_ENTRY_LIMITS: Readonly<JournalZipEntryLimits> = {
  maxEntryCount: MAX_DESKTOP_JOURNAL_ENTRY_COUNT,
  maxEntryBytes: MAX_DESKTOP_JOURNAL_ENTRY_BYTES,
  maxExpandedBytes: MAX_DESKTOP_JOURNAL_EXPANDED_BYTES,
}

function archiveLimitError(message: string): Error {
  return new Error(`Invalid .journal.zip: ${message}`)
}

function canonicalArchivePath(fileName: string): string {
  if (
    !fileName ||
    fileName.includes('\\') ||
    fileName.includes('\0') ||
    fileName.startsWith('/') ||
    /^[A-Za-z]:/.test(fileName)
  ) {
    throw archiveLimitError(`unsafe archive path (${fileName || 'empty path'})`)
  }
  const isDirectory = fileName.endsWith('/')
  const segments = fileName.split('/')
  if (segments.includes('..')) {
    throw archiveLimitError(`archive path traversal (${fileName})`)
  }
  const canonical = `${segments.filter((segment) => segment && segment !== '.').join('/')}${isDirectory ? '/' : ''}`
  if (canonical !== fileName) {
    throw archiveLimitError(`non-canonical archive path (${fileName})`)
  }
  return canonical
}

export function createJournalZipEntryGuard(
  limits: JournalZipEntryLimits = DEFAULT_JOURNAL_ZIP_ENTRY_LIMITS,
): (entry: JournalZipEntryMetadata) => void {
  let entryCount = 0
  let expandedBytes = 0
  const canonicalPaths = new Set<string>()

  return (entry) => {
    entryCount += 1
    if (entryCount > limits.maxEntryCount) {
      throw archiveLimitError(`archive contains more than ${limits.maxEntryCount} entries`)
    }
    if (!Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0 ||
      !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
      throw archiveLimitError(`invalid entry size (${entry.fileName})`)
    }
    if ((entry.generalPurposeBitFlag & 0x0001) !== 0) {
      throw archiveLimitError(`encrypted entries are not supported (${entry.fileName})`)
    }
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw archiveLimitError(`unsupported compression method (${entry.fileName})`)
    }
    if (entry.uncompressedSize > limits.maxEntryBytes) {
      throw archiveLimitError(`entry exceeds ${Math.floor(limits.maxEntryBytes / 1024 / 1024)} MB (${entry.fileName})`)
    }
    expandedBytes += entry.uncompressedSize
    if (expandedBytes > limits.maxExpandedBytes) {
      throw archiveLimitError(`expanded archive exceeds ${Math.floor(limits.maxExpandedBytes / 1024 / 1024)} MB`)
    }

    const mode = (entry.externalFileAttributes >>> 16) & 0xffff
    const fileType = mode & 0xf000
    if (fileType === 0xa000) {
      throw archiveLimitError(`symbolic links are not allowed (${entry.fileName})`)
    }
    if (fileType !== 0 && fileType !== 0x4000 && fileType !== 0x8000) {
      throw archiveLimitError(`non-regular archive entry (${entry.fileName})`)
    }

    const canonical = canonicalArchivePath(entry.fileName)
    const portableKey = canonical.toLowerCase()
    if (canonicalPaths.has(portableKey)) {
      throw archiveLimitError(`duplicate archive path (${entry.fileName})`)
    }
    canonicalPaths.add(portableKey)
  }
}

function openJournalZip(zipFile: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipFile,
      {
        autoClose: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, openedZip) => {
        if (error || !openedZip) {
          reject(error ?? archiveLimitError('unable to open archive'))
          return
        }
        resolve(openedZip)
      },
    )
  })
}

function openJournalZipEntry(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? archiveLimitError(`unable to read entry (${entry.fileName})`))
        return
      }
      resolve(stream)
    })
  })
}

async function extractZipToDir(zipFilePath: string, destinationDir: string): Promise<void> {
  const archiveStat = fs.statSync(zipFilePath)
  if (!archiveStat.isFile() || archiveStat.size === 0) {
    throw archiveLimitError('archive must be a non-empty regular file')
  }
  if (archiveStat.size > MAX_DESKTOP_JOURNAL_ARCHIVE_BYTES) {
    throw archiveLimitError(`compressed archive exceeds ${MAX_DESKTOP_JOURNAL_ARCHIVE_BYTES / 1024 / 1024} MB`)
  }

  const destinationRoot = path.resolve(destinationDir)
  fs.mkdirSync(destinationRoot, { recursive: true })
  const openedZip = await openJournalZip(zipFilePath)
  const guardEntry = createJournalZipEntryGuard()

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let currentReadStream: Readable | null = null
    let currentWriteStream: fs.WriteStream | null = null
    let actualExpandedBytes = 0

    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) {
        const normalized = error instanceof Error ? error : new Error(String(error))
        currentReadStream?.destroy(normalized)
        currentWriteStream?.destroy(normalized)
        try { openedZip.close() } catch { /* 已关闭。 */ }
        reject(normalized)
      } else {
        resolve()
      }
    }

    const timeout = setTimeout(() => {
      finish(archiveLimitError('archive extraction timed out'))
    }, DESKTOP_JOURNAL_EXTRACTION_TIMEOUT_MS)

    const extractEntry = async (entry: yauzl.Entry) => {
      try {
        guardEntry(entry)
        const segments = entry.fileName.split('/').filter(Boolean)
        const targetPath = path.resolve(destinationRoot, ...segments)
        if (!isPathInside(destinationRoot, targetPath)) {
          throw archiveLimitError(`archive entry escapes extraction root (${entry.fileName})`)
        }

        const mode = (entry.externalFileAttributes >>> 16) & 0xffff
        const isDirectory = entry.fileName.endsWith('/') || (mode & 0xf000) === 0x4000
        if (isDirectory) {
          fs.mkdirSync(targetPath, { recursive: true })
          openedZip.readEntry()
          return
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        const readStream = await openJournalZipEntry(openedZip, entry)
        const writeStream = fs.createWriteStream(targetPath, { flags: 'wx', mode: 0o600 })
        currentReadStream = readStream
        currentWriteStream = writeStream
        let actualEntryBytes = 0
        readStream.on('data', (chunk: Buffer) => {
          actualEntryBytes += chunk.byteLength
          actualExpandedBytes += chunk.byteLength
          if (actualEntryBytes > MAX_DESKTOP_JOURNAL_ENTRY_BYTES) {
            readStream.destroy(archiveLimitError(`entry exceeds ${MAX_DESKTOP_JOURNAL_ENTRY_BYTES / 1024 / 1024} MB (${entry.fileName})`))
          } else if (actualExpandedBytes > MAX_DESKTOP_JOURNAL_EXPANDED_BYTES) {
            readStream.destroy(archiveLimitError(`expanded archive exceeds ${MAX_DESKTOP_JOURNAL_EXPANDED_BYTES / 1024 / 1024} MB`))
          }
        })
        await pipeline(readStream, writeStream)
        if (actualEntryBytes !== entry.uncompressedSize) {
          throw archiveLimitError(`entry size does not match ZIP directory (${entry.fileName})`)
        }
        currentReadStream = null
        currentWriteStream = null
        openedZip.readEntry()
      } catch (error) {
        finish(error)
      }
    }

    openedZip.once('error', finish)
    // yauzl 的 end 只表示条目遍历完成；Windows 上 ZIP 文件句柄要到 close 才释放。
    // 等待 close 后再允许调用方清理导入目录，避免 ENOTEMPTY / EPERM 竞态。
    openedZip.once('close', () => finish())
    openedZip.on('entry', (entry: yauzl.Entry) => { void extractEntry(entry) })
    openedZip.readEntry()
  })
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  )
}

export function assertRegularArchiveTree(root: string): void {
  const rootStat = fs.lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Invalid .journal.zip: extracted archive root must be a regular directory')
  }

  const realRoot = fs.realpathSync.native(root)
  const pending = [root]
  let entryCount = 0
  let expandedBytes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const name of fs.readdirSync(current)) {
      const entryPath = path.join(current, name)
      const entryStat = fs.lstatSync(entryPath)
      entryCount += 1
      if (entryCount > MAX_DESKTOP_JOURNAL_ENTRY_COUNT) {
        throw archiveLimitError(`archive contains more than ${MAX_DESKTOP_JOURNAL_ENTRY_COUNT} entries`)
      }
      if (entryStat.isSymbolicLink()) {
        throw new Error(`Invalid .journal.zip: symbolic links are not allowed (${path.relative(root, entryPath)})`)
      }
      if (!entryStat.isFile() && !entryStat.isDirectory()) {
        throw new Error(`Invalid .journal.zip: non-regular archive entry (${path.relative(root, entryPath)})`)
      }

      const realEntry = fs.realpathSync.native(entryPath)
      if (!isPathInside(realRoot, realEntry)) {
        throw new Error(`Invalid .journal.zip: archive entry escapes extraction root (${path.relative(root, entryPath)})`)
      }
      if (entryStat.isDirectory()) {
        pending.push(entryPath)
      } else {
        if (entryStat.size > MAX_DESKTOP_JOURNAL_ENTRY_BYTES) {
          throw archiveLimitError(`entry exceeds ${MAX_DESKTOP_JOURNAL_ENTRY_BYTES / 1024 / 1024} MB (${path.relative(root, entryPath)})`)
        }
        expandedBytes += entryStat.size
        if (expandedBytes > MAX_DESKTOP_JOURNAL_EXPANDED_BYTES) {
          throw archiveLimitError(`expanded archive exceeds ${MAX_DESKTOP_JOURNAL_EXPANDED_BYTES / 1024 / 1024} MB`)
        }
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateWebArchiveVersions(raw: Record<string, unknown>): void {
  if (!Number.isInteger(raw.version) || Number(raw.version) < 1) {
    throw new Error('Invalid .journal.zip: data.json is missing a valid export version')
  }
  if (Number(raw.version) > WEB_JOURNAL_EXPORT_VERSION) {
    throw new Error(
      `该 Web 归档来自更新版本（v${raw.version}），当前仅支持至 v${WEB_JOURNAL_EXPORT_VERSION}`,
    )
  }

  if (raw.schemaVersion === undefined) return
  if (!Number.isInteger(raw.schemaVersion) || Number(raw.schemaVersion) < 1) {
    throw new Error('Invalid .journal.zip: data.json contains an invalid schema version')
  }
  if (Number(raw.schemaVersion) > SCHEMA_VERSION) {
    throw new Error(
      `该 Web 归档的资料库来自更新版本（v${raw.schemaVersion}），当前仅支持至 v${SCHEMA_VERSION}`,
    )
  }
}

interface WebAssetImport {
  id: string
  mime: string
  fileName: string
  sourcePath: string
}

function isCompatibleWebAssetExtension(mime: string, extension: string): boolean {
  return webJournalExtensionsForMime(mime).has(extension)
}

function validateWebAssets(
  value: unknown,
  snapshot: PersistedSnapshot,
  assetsDir: string,
): WebAssetImport[] {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error('Invalid .journal.zip: data.json assets must be an array')
  }

  const declarations = new Map<string, { id: string; mime: string }>()
  for (const item of value ?? []) {
    if (!isRecord(item) || !isSafeAssetId(item.id)) {
      throw new Error('Invalid .journal.zip: data.json contains an invalid asset id')
    }
    const mime = normalizeWebJournalImageMime(item.mime)
    if (!mime) {
      throw new Error(`Invalid .journal.zip: asset ${item.id} has an invalid image MIME type`)
    }
    if (declarations.has(item.id)) {
      throw new Error(`Invalid .journal.zip: duplicate asset declaration (${item.id})`)
    }
    declarations.set(item.id, { id: item.id, mime })
  }

  const referencedIds = new Set<string>()
  for (const trade of snapshot.trades) {
    const note = typeof trade.note === 'string' ? trade.note : ''
    for (const match of note.matchAll(/journal-asset:\/\/([^"'\s>]+)/g)) {
      const id = match[1]
      if (!isSafeAssetId(id)) {
        throw new Error(
          `Invalid .journal.zip: trade ${trade.ref || trade.id} references an invalid asset`,
        )
      }
      if (!declarations.has(id)) {
        throw new Error(
          `Invalid .journal.zip: trade ${trade.ref || trade.id} references an undeclared asset (${id})`,
        )
      }
      referencedIds.add(id)
    }
  }
  for (const review of snapshot.weeklyReviews ?? []) {
    for (const match of review.contentHtml.matchAll(/journal-asset:\/\/([^"'\s>]+)/g)) {
      const id = match[1]
      if (!isSafeAssetId(id)) {
        throw new Error(`Invalid .journal.zip: weekly review ${review.weekStart} references an invalid asset`)
      }
      if (!declarations.has(id)) {
        throw new Error(`Invalid .journal.zip: weekly review ${review.weekStart} references missing asset ${id}`)
      }
      referencedIds.add(id)
    }
  }
  for (const note of snapshot.quickNotes ?? []) {
    for (const match of note.contentHtml.matchAll(/journal-asset:\/\/([^"'\s>]+)/g)) {
      const id = match[1]
      if (!isSafeAssetId(id)) {
        throw new Error(`Invalid .journal.zip: quick note ${note.id} references an invalid asset`)
      }
      if (!declarations.has(id)) {
        throw new Error(`Invalid .journal.zip: quick note ${note.id} references missing asset ${id}`)
      }
      referencedIds.add(id)
    }
  }
  for (const id of declarations.keys()) {
    if (!referencedIds.has(id)) {
      throw new Error(`Invalid .journal.zip: asset ${id} 未被任何交易正文引用`)
    }
  }

  const files = new Map<string, WebAssetImport>()
  if (fs.existsSync(assetsDir)) {
    for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        throw new Error(
          `Invalid .journal.zip: assets contains an unsupported entry (${entry.name})`,
        )
      }
      const match = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]+)$/.exec(entry.name)
      if (!match) {
        throw new Error(`Invalid .journal.zip: assets contains an invalid file name (${entry.name})`)
      }
      const [, id, extension] = match
      const declaration = declarations.get(id)
      if (!declaration) {
        throw new Error(`Invalid .journal.zip: asset file is not declared (${id})`)
      }
      if (files.has(id)) {
        throw new Error(`Invalid .journal.zip: duplicate asset file (${id})`)
      }
      const normalizedExtension = extension.toLowerCase()
      if (
        extension !== normalizedExtension ||
        !isCompatibleWebAssetExtension(declaration.mime, normalizedExtension)
      ) {
        throw new Error(`Invalid .journal.zip: asset ${id} extension does not match its MIME type`)
      }
      files.set(id, {
        ...declaration,
        fileName: entry.name,
        sourcePath: path.join(assetsDir, entry.name),
      })
    }
  }

  for (const id of declarations.keys()) {
    if (!files.has(id)) {
      throw new Error(`Invalid .journal.zip: declared asset is missing (${id})`)
    }
  }
  return [...declarations.keys()].map((id) => files.get(id)!)
}

function readWebSnapshot(dataFile: string, assetsDir: string): {
  snapshot: PersistedSnapshot
  assets: WebAssetImport[]
} {
  const parsed: unknown = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error('Invalid .journal.zip: data.json must contain an object')
  }
  const raw = parsed as Partial<PersistedSnapshot> & Record<string, unknown>
  validateWebArchiveVersions(raw)
  const snapshot = decodeCanonicalSnapshot(raw, {
    version: Number(raw.schemaVersion ?? raw.version),
    label: 'Invalid .journal.zip: data.json snapshot',
  })
  return { snapshot, assets: validateWebAssets(raw.assets, snapshot, assetsDir) }
}

function validateManifest(manifestFile: string): LibraryManifest {
  let manifest: unknown
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  } catch {
    throw new Error('Invalid .journal.zip: manifest.json is not valid JSON')
  }
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('Invalid .journal.zip: manifest.json is missing required library fields')
  }
  const fields = manifest as Record<string, unknown>
  if (
    !Number.isInteger(fields.schemaVersion) ||
    Number(fields.schemaVersion) < 1 ||
    typeof fields.libraryId !== 'string' ||
    fields.libraryId.length === 0
  ) {
    throw new Error('Invalid .journal.zip: manifest.json is missing required library fields')
  }
  if (Number(fields.schemaVersion) > SCHEMA_VERSION) {
    throw new Error(
      `该桌面归档来自更新版本（v${fields.schemaVersion}），当前仅支持至 v${SCHEMA_VERSION}`,
    )
  }
  return fields as unknown as LibraryManifest
}

export interface LibraryDatabaseInspection {
  tradeCount: number
  strategyCount: number
  assets: { id: string; mime: string; fileName: string; byteSize: number }[]
  referencedAssetIds: string[]
}

export async function validateLibraryDatabaseFile(
  dbFile: string,
  options: { allowEmptySnapshot?: boolean; schemaVersion?: number } = {},
): Promise<LibraryDatabaseInspection> {
  const SQL = await initSqlJs({ locateFile: locateSqlWasm })
  let db: InstanceType<typeof SQL.Database> | null = null
  try {
    db = new SQL.Database(fs.readFileSync(dbFile))
    const tables = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'assets')",
    )
    const names = new Set((tables[0]?.values ?? []).map((row) => String(row[0])))
    if (!names.has('meta') || !names.has('assets')) {
      throw new Error('database is missing required tables')
    }

    const snapshotRows = db.exec("SELECT value FROM meta WHERE key = 'snapshot'")
    const snapshotText = snapshotRows[0]?.values[0]?.[0]
    let snapshot: PersistedSnapshot | null = null
    if (snapshotText == null) {
      if (!options.allowEmptySnapshot) throw new Error('database snapshot is missing')
    } else {
      const parsed: unknown = JSON.parse(String(snapshotText))
      snapshot = decodeCanonicalSnapshot(parsed, {
        version: options.schemaVersion ?? SCHEMA_VERSION,
        label: 'database snapshot',
      })
    }

    const referencedAssetIds = new Set<string>()
    for (const trade of snapshot?.trades ?? []) {
      const note = typeof trade.note === 'string' ? trade.note : ''
      const pattern = /journal-asset:\/\/([^"'\s>]+)/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(note)) !== null) {
        if (match[1]) referencedAssetIds.add(match[1])
      }
    }
    for (const review of snapshot?.weeklyReviews ?? []) {
      const pattern = /journal-asset:\/\/([^"'\s>]+)/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(review.contentHtml)) !== null) {
        if (match[1]) referencedAssetIds.add(match[1])
      }
    }
    for (const note of snapshot?.quickNotes ?? []) {
      const pattern = /journal-asset:\/\/([^"'\s>]+)/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(note.contentHtml)) !== null) {
        if (match[1]) referencedAssetIds.add(match[1])
      }
    }

    const assetRows = db.exec('SELECT id, mime, file_name, byte_size FROM assets')
    const assets = (assetRows[0]?.values ?? []).map((row) => ({
      id: String(row[0] ?? ''),
      mime: String(row[1] ?? ''),
      fileName: String(row[2] ?? ''),
      byteSize: Number(row[3]),
    }))
    const assetIds = new Set<string>()
    const assetFileNames = new Set<string>()
    if (!snapshot && assets.length > 0) {
      throw new Error('empty database contains orphaned assets')
    }
    for (const asset of assets) {
      const { fileName } = asset
      if (!fileName || path.basename(fileName) !== fileName) {
        throw new Error('asset metadata contains an unsafe file path')
      }
      if (!isSafeAssetId(asset.id) || !asset.mime || !Number.isFinite(asset.byteSize) || asset.byteSize < 0) {
        throw new Error('asset metadata is invalid')
      }
      if (assetIds.has(asset.id) || assetFileNames.has(asset.fileName)) {
        throw new Error('asset metadata contains duplicate identifiers or files')
      }
      assetIds.add(asset.id)
      assetFileNames.add(asset.fileName)
    }
    for (const referencedId of referencedAssetIds) {
      if (!assetIds.has(referencedId)) {
        throw new Error(`snapshot references a missing asset (${referencedId})`)
      }
    }
    return {
      tradeCount: snapshot?.trades.length ?? 0,
      strategyCount: snapshot?.strategies.length ?? 0,
      assets,
      referencedAssetIds: [...referencedAssetIds],
    }
  } catch (err) {
    throw new Error(
      `Invalid .journal.zip: journal.db could not be validated (${err instanceof Error ? err.message : String(err)})`,
    )
  } finally {
    db?.close()
  }
}

export async function validateDesktopLibrary(
  paths: ReturnType<typeof ensureLibraryDirs>,
  options: { allowEmptySnapshot?: boolean } = {},
): Promise<LibraryDatabaseInspection> {
  const manifest = validateManifest(paths.manifestFile)
  const inspection = await validateLibraryDatabaseFile(paths.dbFile, {
    ...options,
    schemaVersion: manifest.schemaVersion,
  })
  const expectedAssets = new Map(inspection.assets.map((asset) => [asset.fileName, asset]))
  const actualFileNames: string[] = []

  if (fs.existsSync(paths.attachments)) {
    const attachmentsStat = fs.lstatSync(paths.attachments)
    if (attachmentsStat.isSymbolicLink() || !attachmentsStat.isDirectory()) {
      throw new Error('Invalid .journal.zip: attachments must be a regular directory')
    }
    actualFileNames.push(...fs.readdirSync(paths.attachments))
  }

  for (const fileName of actualFileNames) {
    const filePath = path.join(paths.attachments, fileName)
    const fileStat = fs.lstatSync(filePath)
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Invalid .journal.zip: attachment must not be a symbolic link (${fileName})`)
    }
    if (!fileStat.isFile()) {
      throw new Error(`Invalid .journal.zip: attachment must be a regular file (${fileName})`)
    }
    const asset = expectedAssets.get(fileName)
    if (!asset) {
      throw new Error(`Invalid .journal.zip: unexpected attachment (${fileName})`)
    }
    if (fileStat.size !== asset.byteSize) {
      throw new Error(`Invalid .journal.zip: attachment is missing or incomplete (${fileName})`)
    }
    expectedAssets.delete(fileName)
  }

  const missingFileName = expectedAssets.keys().next().value as string | undefined
  if (missingFileName) {
    throw new Error(`Invalid .journal.zip: attachment is missing or incomplete (${missingFileName})`)
  }
  return inspection
}

function writeImportProgress(message: string): void {
  const progressPath = process.env.LINEAR_JOURNAL_QA_PROGRESS
  if (!progressPath) return
  fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`, 'utf8')
}

async function importWebJournalZip(
  paths: ReturnType<typeof ensureLibraryDirs>,
  tempDir: string,
  copyAsset: (source: string, destination: string, index: number) => void,
): Promise<void> {
  const dataSrc = path.join(tempDir, 'data.json')
  const assetsSrc = path.join(tempDir, 'assets')
  const { snapshot, assets } = readWebSnapshot(dataSrc, assetsSrc)
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
  for (const [index, asset] of assets.entries()) {
    const dest = path.join(paths.attachments, asset.fileName)
    copyAsset(asset.sourcePath, dest, index)
    db.run(
      `INSERT INTO assets (id, mime, file_name, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [asset.id, asset.mime, asset.fileName, fs.statSync(dest).size, createdAt],
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
  const files: Array<{ name: string; sourceFile: string }> = []
  if (fs.existsSync(source)) {
    const sourceStat = fs.lstatSync(source)
    if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
      throw new Error('Attachment source must be a regular directory')
    }
  }
  for (const name of fs.existsSync(source) ? fs.readdirSync(source) : []) {
    const sourceFile = path.join(source, name)
    const fileStat = fs.lstatSync(sourceFile)
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Attachment source must not contain symbolic links (${name})`)
    }
    if (!fileStat.isFile()) {
      throw new Error(`Attachment source must contain regular files only (${name})`)
    }
    files.push({ name, sourceFile })
  }

  clearDirectory(destination)
  for (const file of files) {
    fs.copyFileSync(file.sourceFile, path.join(destination, file.name))
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
  options: {
    copyWebAsset?: (source: string, destination: string, index: number) => void
  } = {},
): Promise<void> {
  const paths = ensureLibraryDirs(libraryRoot)
  const tempDir = path.join(libraryRoot, `.import-${Date.now()}`)
  const preImportBackup = path.join(libraryRoot, `.pre-import-${Date.now()}`)
  const extractedRoot = path.join(tempDir, 'extracted')
  const preparedRoot = path.join(tempDir, 'prepared')
  fs.mkdirSync(tempDir, { recursive: true })
  let mutationStarted = false
  let keepRecoveryBackup = false

  try {
    writeImportProgress('importZip: extract start')
    await extractZipToDir(zipFile, extractedRoot)
    assertRegularArchiveTree(extractedRoot)
    writeImportProgress('importZip: extract done')

    const manifestSrc = path.join(extractedRoot, 'manifest.json')
    const dbSrc = path.join(extractedRoot, 'journal.db')
    const dataSrc = path.join(extractedRoot, 'data.json')
    const attachmentsSrc = path.join(extractedRoot, 'attachments')
    const preparedPaths = ensureLibraryDirs(preparedRoot)

    if (fs.existsSync(manifestSrc) && fs.existsSync(dbSrc)) {
      fs.copyFileSync(manifestSrc, preparedPaths.manifestFile)
      fs.copyFileSync(dbSrc, preparedPaths.dbFile)
      copyAttachmentFiles(attachmentsSrc, preparedPaths.attachments)
    } else if (fs.existsSync(dataSrc)) {
      await importWebJournalZip(
        preparedPaths,
        extractedRoot,
        options.copyWebAsset ?? ((source, destination) => fs.copyFileSync(source, destination)),
      )
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
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 })
    if (!keepRecoveryBackup) {
      fs.rmSync(preImportBackup, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 })
    }
    writeImportProgress('importZip: cleanup done')
  }
}

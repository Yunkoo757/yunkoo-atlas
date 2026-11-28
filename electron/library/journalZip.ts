import { readCompatibleLibraryManifest } from './libraryIdentity'
import { beginLibraryReplacement } from './libraryReplacement'
import { copyLibraryAttachments } from './attachmentFiles'
import { LibraryInspectionError, validateDesktopLibrary } from './libraryInspection'
import { CREATE_LIBRARY_TABLES_SQL, validateLibraryAssetIndex } from '../../src/storage/libraryDatabase'
import { crc32 } from '../../src/lib/crc32'
import { retiredSnapshotDatabaseBytes } from './retiredSnapshotDatabase'
import fs from 'node:fs'
import path from 'node:path'
import { clearManagedFlatDirectory } from './managedPaths'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ZipArchive } from 'archiver'
import { getLibrarySql } from './sqliteRuntime'
import * as yauzl from 'yauzl'
import type { LibraryStorage } from './storage'
import { ensureLibraryDirs, getLibraryPaths } from './paths'
import { fsyncDirectorySync, fsyncFileSync, writeFileAtomicallySync } from './atomicFile'
import {
  SCHEMA_VERSION,
  type PersistedSnapshot,
} from '../../src/storage/types'
import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { collectRetiredSnapshotAssetIds } from '../../src/storage/retiredSnapshotDomains'
import {
  readWebJournalAssetDeclarations,
  readWebJournalVersions,
  validateWebJournalAssetReferences,
  webJournalExtensionsForMime,
} from '../../src/lib/webJournalArchiveContract'

export async function exportJournalZip(
  storage: LibraryStorage,
  destinationFile: string,
): Promise<void> {
  const paths = storage.getPaths()
  fs.mkdirSync(path.dirname(destinationFile), { recursive: true })
  const realLibraryRoot = fs.realpathSync.native(paths.root)
  const realDestinationParent = fs.realpathSync.native(path.dirname(destinationFile))
  const resolvedDestination = path.join(realDestinationParent, path.basename(destinationFile))
  if (isPathInside(realLibraryRoot, resolvedDestination)) {
    throw new Error('导出目标不能位于当前资料库目录内')
  }
  const temporaryFile = path.join(
    path.dirname(destinationFile),
    `.${path.basename(destinationFile)}.${process.pid}.${randomUUID()}.tmp`,
  )

  const databaseStat = fs.lstatSync(paths.dbFile)
  if (databaseStat.isSymbolicLink() || !databaseStat.isFile()) {
    throw new Error('当前资料库数据库不是普通文件，无法安全导出')
  }
  const data = storage.captureLibraryExport('archive')
  const archiveAttachments = data.attachments.map(({ fileName, byteSize }) => {
    if (!fileName || path.basename(fileName) !== fileName) {
      throw new Error(`附件元数据包含不安全路径（${fileName}）`)
    }
    const attachmentFile = path.join(paths.attachments, fileName)
    const attachmentStat = fs.lstatSync(attachmentFile)
    if (attachmentStat.isSymbolicLink() || !attachmentStat.isFile() || attachmentStat.size !== byteSize) {
      throw new Error(`附件缺失或不完整（${fileName}）`)
    }
    return { fileName, attachmentFile }
  })
  try {
    const output = fs.createWriteStream(temporaryFile, { flags: 'wx' })
    const archive = new ZipArchive({ zlib: { level: 9 } })
    const completed = pipeline(archive, output)

    archive.append(data.manifestBytes, { name: 'manifest.json' })
    archive.append(data.databaseBytes, { name: 'journal.db' })

    for (const { fileName, attachmentFile } of archiveAttachments) {
      archive.file(attachmentFile, {
        name: `attachments/${fileName}`,
      })
    }
    await Promise.all([archive.finalize(), completed])
    fsyncFileSync(temporaryFile)
    fs.renameSync(temporaryFile, destinationFile)
    fsyncDirectorySync(path.dirname(destinationFile))
  } finally {
    fs.rmSync(temporaryFile, { force: true })
  }
}

function clearDirectory(dir: string): void {
  clearManagedFlatDirectory(path.dirname(dir), dir, path.basename(dir))
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

function invalidArchive(message: string): Error {
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
    throw invalidArchive(`unsafe archive path (${fileName || 'empty path'})`)
  }
  const isDirectory = fileName.endsWith('/')
  const segments = fileName.split('/')
  if (segments.includes('..')) {
    throw invalidArchive(`archive path traversal (${fileName})`)
  }
  const canonical = `${segments.filter((segment) => segment && segment !== '.').join('/')}${isDirectory ? '/' : ''}`
  if (canonical !== fileName) {
    throw invalidArchive(`non-canonical archive path (${fileName})`)
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
      throw invalidArchive(`archive contains more than ${limits.maxEntryCount} entries`)
    }
    if (!Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0 ||
      !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
      throw invalidArchive(`invalid entry size (${entry.fileName})`)
    }
    if ((entry.generalPurposeBitFlag & 0x0001) !== 0) {
      throw invalidArchive(`encrypted entries are not supported (${entry.fileName})`)
    }
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw invalidArchive(`unsupported compression method (${entry.fileName})`)
    }
    if (entry.uncompressedSize > limits.maxEntryBytes) {
      throw invalidArchive(`entry exceeds ${Math.floor(limits.maxEntryBytes / 1024 / 1024)} MB (${entry.fileName})`)
    }
    expandedBytes += entry.uncompressedSize
    if (expandedBytes > limits.maxExpandedBytes) {
      throw invalidArchive(`expanded archive exceeds ${Math.floor(limits.maxExpandedBytes / 1024 / 1024)} MB`)
    }

    const mode = (entry.externalFileAttributes >>> 16) & 0xffff
    const fileType = mode & 0xf000
    if (fileType === 0xa000) {
      throw invalidArchive(`symbolic links are not allowed (${entry.fileName})`)
    }
    if (fileType !== 0 && fileType !== 0x4000 && fileType !== 0x8000) {
      throw invalidArchive(`non-regular archive entry (${entry.fileName})`)
    }

    const canonical = canonicalArchivePath(entry.fileName)
    const portableKey = canonical.toLowerCase()
    if (canonicalPaths.has(portableKey)) {
      throw invalidArchive(`duplicate archive path (${entry.fileName})`)
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
          reject(error ?? invalidArchive('unable to open archive'))
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
        reject(error ?? invalidArchive(`unable to read entry (${entry.fileName})`))
        return
      }
      resolve(stream)
    })
  })
}

async function extractZipToDir(zipFilePath: string, destinationDir: string): Promise<void> {
  const archiveStat = fs.statSync(zipFilePath)
  if (!archiveStat.isFile() || archiveStat.size === 0) {
    throw invalidArchive('archive must be a non-empty regular file')
  }
  if (archiveStat.size > MAX_DESKTOP_JOURNAL_ARCHIVE_BYTES) {
    throw invalidArchive(`compressed archive exceeds ${MAX_DESKTOP_JOURNAL_ARCHIVE_BYTES / 1024 / 1024} MB`)
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
      finish(invalidArchive('archive extraction timed out'))
    }, DESKTOP_JOURNAL_EXTRACTION_TIMEOUT_MS)

    const extractEntry = async (entry: yauzl.Entry) => {
      try {
        guardEntry(entry)
        const segments = entry.fileName.split('/').filter(Boolean)
        const targetPath = path.resolve(destinationRoot, ...segments)
        if (!isPathInside(destinationRoot, targetPath)) {
          throw invalidArchive(`archive entry escapes extraction root (${entry.fileName})`)
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
        let entryCrc32 = 0
        readStream.on('data', (chunk: Buffer) => {
          actualEntryBytes += chunk.byteLength
          actualExpandedBytes += chunk.byteLength
          entryCrc32 = crc32(chunk, entryCrc32)
          if (actualEntryBytes > MAX_DESKTOP_JOURNAL_ENTRY_BYTES) {
            readStream.destroy(invalidArchive(`entry exceeds ${MAX_DESKTOP_JOURNAL_ENTRY_BYTES / 1024 / 1024} MB (${entry.fileName})`))
          } else if (actualExpandedBytes > MAX_DESKTOP_JOURNAL_EXPANDED_BYTES) {
            readStream.destroy(invalidArchive(`expanded archive exceeds ${MAX_DESKTOP_JOURNAL_EXPANDED_BYTES / 1024 / 1024} MB`))
          }
        })
        await pipeline(readStream, writeStream)
        if (actualEntryBytes !== entry.uncompressedSize) {
          throw invalidArchive(`entry size does not match ZIP directory (${entry.fileName})`)
        }
        if (entryCrc32 !== (entry.crc32 >>> 0)) {
          throw invalidArchive(`entry CRC does not match ZIP directory (${entry.fileName})`)
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
        throw invalidArchive(`archive contains more than ${MAX_DESKTOP_JOURNAL_ENTRY_COUNT} entries`)
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
          throw invalidArchive(`entry exceeds ${MAX_DESKTOP_JOURNAL_ENTRY_BYTES / 1024 / 1024} MB (${path.relative(root, entryPath)})`)
        }
        expandedBytes += entryStat.size
        if (expandedBytes > MAX_DESKTOP_JOURNAL_EXPANDED_BYTES) {
          throw invalidArchive(`expanded archive exceeds ${MAX_DESKTOP_JOURNAL_EXPANDED_BYTES / 1024 / 1024} MB`)
        }
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface WebAssetImport {
  id: string
  mime: string
  fileName: string
  sourcePath: string
}

function validateWebAssets(
  value: unknown,
  snapshot: PersistedSnapshot,
  assetsDir: string,
  retiredIds: ReadonlySet<string> = new Set(),
): WebAssetImport[] {
  const declarations = readWebJournalAssetDeclarations(value, 'desktop')
  const referencedIds = validateWebJournalAssetReferences(snapshot, declarations, retiredIds, 'desktop')

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
      const mime = declarations.get(id)
      if (!mime) {
        throw new Error(`Invalid .journal.zip: asset file is not declared (${id})`)
      }
      if (files.has(id)) {
        throw new Error(`Invalid .journal.zip: duplicate asset file (${id})`)
      }
      if (!webJournalExtensionsForMime(mime).has(extension)) {
        throw new Error(`Invalid .journal.zip: asset ${id} extension does not match its MIME type`)
      }
      files.set(id, {
        id,
        mime,
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
  const retained = [...declarations.keys()]
    .filter(id => referencedIds.has(id) || !retiredIds.has(id))
    .map((id) => files.get(id)!)
  validateLibraryAssetIndex(retained)
  return retained
}

function readWebSnapshot(dataFile: string, assetsDir: string): {
  snapshot: PersistedSnapshot
  assets: WebAssetImport[]
} {
  const parsed: unknown = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error('Invalid .journal.zip: data.json must contain an object')
  }
  const raw = parsed
  const { exportVersion, schemaVersion } = readWebJournalVersions(raw, 'desktop')
  const snapshot = decodeCanonicalSnapshot(raw, {
    version: schemaVersion ?? exportVersion,
    label: 'Invalid .journal.zip: data.json snapshot',
  })
  return { snapshot, assets: validateWebAssets(raw.assets, snapshot, assetsDir, collectRetiredSnapshotAssetIds(raw)) }
}

async function validateArchiveLibrary(paths: ReturnType<typeof getLibraryPaths>): Promise<void> {
  try {
    await validateDesktopLibrary(paths)
  } catch (error) {
    if (error instanceof LibraryInspectionError) throw invalidArchive(error.message)
    throw error
  }
}

async function validatePreparedLibrary(paths: ReturnType<typeof getLibraryPaths>): Promise<void> {
  writeImportProgress('importZip: validate prepared library start')
  await validateArchiveLibrary(paths)
  const dbFile = paths.dbFile
  const SQL = await getLibrarySql()
  const original = fs.readFileSync(dbFile)
  const retired = retiredSnapshotDatabaseBytes(original, SQL.Database)
  if (retired !== original) {
    writeFileAtomicallySync(dbFile, retired)
    await validateArchiveLibrary(paths)
  }
  writeImportProgress('importZip: validate prepared library done')
}

function writeImportProgress(message: string): void {
  const progressPath = process.env.TRADER_ATLAS_QA_PROGRESS
  if (!progressPath) return
  try {
    fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    /* QA 进度日志不得改变导入事务结果。 */
  }
}

async function importWebJournalZip(
  paths: ReturnType<typeof ensureLibraryDirs>,
  tempDir: string,
  libraryId: string,
  copyAsset: (source: string, destination: string, index: number) => void,
): Promise<void> {
  const dataSrc = path.join(tempDir, 'data.json')
  const assetsSrc = path.join(tempDir, 'assets')
  const { snapshot, assets } = readWebSnapshot(dataSrc, assetsSrc)
  const SQL = await getLibrarySql()
  const db = new SQL.Database()

  db.run(CREATE_LIBRARY_TABLES_SQL)
  db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [
    'snapshot',
    JSON.stringify(snapshot),
  ])
  db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [
    'schemaVersion',
    String(SCHEMA_VERSION),
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
      libraryId,
      createdAt,
      platform: 'electron',
    }, null, 2),
    'utf8',
  )
}

interface JournalArchivePreparation {
  libraryId?: string
  copyWebAsset?: (source: string, destination: string, index: number) => void
}

/** 调用方持有私有暂存目录，直到预览取消或提交。只有提交入口会写入活动库。 */
export async function prepareJournalArchive(
  stagingRoot: string,
  zipFile: string,
  options: JournalArchivePreparation = {},
) {
  const preparedPaths = ensureLibraryDirs(fs.mkdtempSync(path.join(stagingRoot, 'library-')))
  const extractedRoot = fs.mkdtempSync(path.join(stagingRoot, 'extracted-'))
  try {
    writeImportProgress('importZip: extract start')
    await extractZipToDir(zipFile, extractedRoot)
    assertRegularArchiveTree(extractedRoot)
    writeImportProgress('importZip: extract done')

    const manifestSrc = path.join(extractedRoot, 'manifest.json')
    const dbSrc = path.join(extractedRoot, 'journal.db')
    const dataSrc = path.join(extractedRoot, 'data.json')
    const attachmentsSrc = path.join(extractedRoot, 'attachments')

    if (fs.existsSync(manifestSrc) && fs.existsSync(dbSrc)) {
      fs.copyFileSync(manifestSrc, preparedPaths.manifestFile)
      fs.copyFileSync(dbSrc, preparedPaths.dbFile)
      copyLibraryAttachments(attachmentsSrc, preparedPaths.attachments)
      if (options.libraryId) {
        const importedManifest = readCompatibleLibraryManifest(preparedPaths.manifestFile)
        writeFileAtomicallySync(
          preparedPaths.manifestFile,
          JSON.stringify({ ...importedManifest, libraryId: options.libraryId }, null, 2),
          'utf8',
        )
      }
    } else if (fs.existsSync(dataSrc)) {
      await importWebJournalZip(
        preparedPaths,
        extractedRoot,
        options.libraryId ?? randomUUID(),
        options.copyWebAsset ?? ((source, destination) => fs.copyFileSync(source, destination)),
      )
    } else {
      throw new Error('Invalid .journal.zip: missing manifest.json/journal.db or data.json')
    }

    await validatePreparedLibrary(preparedPaths)
    return preparedPaths
  } finally {
    try {
      fs.rmSync(extractedRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 })
    } catch { /* 调用方释放整个暂存目录时会再清理仍被占用的文件。 */ }
  }
}

export async function importJournalZipToPath(
  libraryRoot: string,
  zipFile: string,
  options: Pick<JournalArchivePreparation, 'copyWebAsset'> = {},
): Promise<void> {
  const paths = ensureLibraryDirs(libraryRoot)
  const libraryId = fs.existsSync(paths.manifestFile) ? readCompatibleLibraryManifest(paths.manifestFile).libraryId : undefined
  const stagingRoot = fs.mkdtempSync(path.join(libraryRoot, '.import-'))
  try {
    const prepared = await prepareJournalArchive(stagingRoot, zipFile, { ...options, libraryId })
    await replaceLibraryFiles(paths, prepared)
  } catch (error) {
    writeImportProgress(`importZip: error ${error instanceof Error ? error.message : String(error)}`)
    throw error
  } finally {
    writeImportProgress('importZip: cleanup start')
    try { fs.rmSync(stagingRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 }) } catch { /* 保留现场。 */ }
    writeImportProgress('importZip: cleanup done')
  }
}

/** 用户确认后复核私有候选；原始归档可能已经改变。 */
export async function installPreparedLibraryAtPath(libraryRoot: string, preparedRoot: string): Promise<void> {
  const preparedStat = fs.lstatSync(preparedRoot)
  if (preparedStat.isSymbolicLink() || !preparedStat.isDirectory()) throw new Error('恢复候选不是普通目录')
  const preparedPaths = getLibraryPaths(preparedRoot)
  await validatePreparedLibrary(preparedPaths)
  await replaceLibraryFiles(ensureLibraryDirs(libraryRoot), preparedPaths)
}

async function replaceLibraryFiles(
  paths: ReturnType<typeof getLibraryPaths>,
  preparedPaths: ReturnType<typeof getLibraryPaths>,
): Promise<void> {
  writeImportProgress('importZip: backup current library start')
  const transaction = beginLibraryReplacement(paths, 'journal')
  try {
    writeImportProgress('importZip: backup current library done')
    writeFileAtomicallySync(paths.manifestFile, fs.readFileSync(preparedPaths.manifestFile))
    writeFileAtomicallySync(paths.dbFile, fs.readFileSync(preparedPaths.dbFile))
    copyLibraryAttachments(preparedPaths.attachments, paths.attachments, { durable: true })
    await validateArchiveLibrary(paths)
    transaction.commit()
  } catch (error) {
    try { transaction.rollback() }
    catch (restoreError) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        `恢复当前交易库失败，安全副本已保留在 ${transaction.directory}: ` +
        `${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
      )
    }
    throw error
  }
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import JSZip from 'jszip'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import { WEB_JOURNAL_EXPORT_VERSION } from '../../src/lib/webJournalArchiveContract'
import { SCHEMA_VERSION, type PersistedSnapshot } from '../../src/storage/types'
import {
  MAX_DESKTOP_JOURNAL_ARCHIVE_BYTES,
  assertRegularArchiveTree,
  createJournalZipEntryGuard,
  importJournalZipToPath,
  validateDesktopLibrary,
} from './journalZip'
import { LibraryStorage } from './storage'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function emptySnapshot(): PersistedSnapshot {
  return {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }
}

function snapshotWithAsset(assetId: string): PersistedSnapshot {
  return {
    ...emptySnapshot(),
    trades: [{
      id: 'trade-with-asset',
      ref: 'TRD-ASSET',
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'open',
      conviction: 'medium',
      strategyId: 'uncategorized',
      tradeKind: 'live',
      tags: [],
      mistakeTags: [],
      reviewStatus: 'unreviewed',
      reviewCategory: 'normal',
      entry: 100,
      exit: null,
      size: 1,
      pnl: null,
      rMultiple: null,
      openedAt: '2026-07-16',
      closedAt: null,
      note: `<img src="journal-asset://${assetId}">`,
    }],
  }
}

function zipEntry(fileName: string, uncompressedSize: number) {
  return {
    fileName,
    compressedSize: uncompressedSize,
    uncompressedSize,
    compressionMethod: 8,
    generalPurposeBitFlag: 0,
    externalFileAttributes: 0,
  }
}

async function writeWebArchive(
  destination: string,
  payload: Record<string, unknown>,
  files: Record<string, Uint8Array | string> = {},
): Promise<void> {
  const zip = new JSZip()
  zip.file('data.json', JSON.stringify(payload))
  for (const [name, data] of Object.entries(files)) zip.file(name, data)
  fs.writeFileSync(destination, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function captureImportError(
  payload: Record<string, unknown>,
  files?: Record<string, Uint8Array | string>,
): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-version-'))
  const archive = path.join(root, 'candidate.journal.zip')
  try {
    await writeWebArchive(archive, payload, files)
    await importJournalZipToPath(root, archive)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testElectronWebImportRejectsFutureExportVersion(): Promise<void> {
  const error = await captureImportError({
    version: WEB_JOURNAL_EXPORT_VERSION + 1,
    schemaVersion: SCHEMA_VERSION,
    ...emptySnapshot(),
    assets: [],
  })

  assert(error.includes('更新版本'), 'Electron 必须在替换资料库前拒绝未来 Web 导出版本')
}

export async function testElectronWebImportRejectsFutureSchemaVersion(): Promise<void> {
  const error = await captureImportError({
    version: WEB_JOURNAL_EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION + 1,
    ...emptySnapshot(),
    assets: [],
  })

  assert(error.includes('更新版本'), 'Electron 必须在替换资料库前拒绝未来 Web 资料库版本')
}

export async function testElectronWebImportRejectsMalformedTradeHistoryBeforeCommit(): Promise<void> {
  const snapshot = snapshotWithAsset('unused')
  snapshot.trades[0] = {
    ...snapshot.trades[0]!,
    note: '',
    comments: {} as never,
  }
  const error = await captureImportError({
    version: WEB_JOURNAL_EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    ...snapshot,
    assets: [],
  })

  assert(error.includes('invalid trade'), 'Electron 必须在替换资料库前拒绝畸形评论历史')
}

export async function testDesktopArchiveRejectsFutureManifestSchema(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-manifest-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const paths = storage.getPaths()
    storage.release()
    const manifest = JSON.parse(fs.readFileSync(paths.manifestFile, 'utf8')) as Record<string, unknown>
    manifest.schemaVersion = SCHEMA_VERSION + 1
    fs.writeFileSync(paths.manifestFile, JSON.stringify(manifest), 'utf8')

    let error = ''
    try {
      await validateDesktopLibrary(paths)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    assert(error.includes('更新版本'), '桌面归档 manifest 高于当前 schema 时必须拒绝')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testDesktopArchiveRejectsUnexpectedAttachment(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-extra-attachment-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const paths = storage.getPaths()
    storage.release()
    fs.writeFileSync(path.join(paths.attachments, 'unexpected.bin'), Buffer.from('unexpected'))

    let error = ''
    try {
      await validateDesktopLibrary(paths)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    assert(error.includes('unexpected attachment'), '桌面归档必须拒绝数据库未声明的额外附件')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testDesktopArchiveRejectsMissingRuntimeIdCollections(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-missing-runtime-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const paths = storage.getPaths()
    storage.release()

    const malformed: Record<string, unknown> = { ...emptySnapshot() }
    delete malformed.subscribedIds
    const SQL = await initSqlJs({
      locateFile: () => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    })
    const db = new SQL.Database(fs.readFileSync(paths.dbFile))
    try {
      db.run('UPDATE meta SET value = ? WHERE key = ?', [JSON.stringify(malformed), 'snapshot'])
      fs.writeFileSync(paths.dbFile, Buffer.from(db.export()))
    } finally {
      db.close()
    }

    let error = ''
    try {
      await validateDesktopLibrary(paths)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    assert(error.includes('subscribedIds must be a string array'), '桌面归档必须在替换资料库前拒绝缺失运行时 ID 集合')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testDesktopArchiveRejectsSymbolicLinkAttachment(): Promise<void> {
  if (process.platform === 'win32') return

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-symlink-attachment-'))
  const outsideFile = path.join(root, 'outside.txt')
  const storage = new LibraryStorage(path.join(root, 'library'))
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const assetId = await storage.saveAssetAsync(Buffer.from('original'), 'text/plain')
    const paths = storage.getPaths()
    const attachmentName = fs.readdirSync(paths.attachments).find((name) => name.startsWith(assetId))
    assert(attachmentName, '测试附件必须已写入')
    storage.release()

    fs.writeFileSync(outsideFile, Buffer.from('original'))
    fs.rmSync(path.join(paths.attachments, attachmentName))
    fs.symlinkSync(outsideFile, path.join(paths.attachments, attachmentName), 'file')

    let error = ''
    try {
      await validateDesktopLibrary(paths)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    assert(error.includes('symbolic link'), '桌面归档必须通过 lstat 拒绝指向库外的符号链接')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testExtractedArchiveTreeRejectsDirectoryLinksWithoutFollowingThem(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-tree-link-'))
  const extractedRoot = path.join(root, 'extracted')
  const outsideDir = path.join(root, 'outside')
  const sentinel = path.join(outsideDir, 'sentinel.txt')
  try {
    fs.mkdirSync(extractedRoot)
    fs.mkdirSync(outsideDir)
    fs.writeFileSync(sentinel, 'keep', 'utf8')
    fs.symlinkSync(
      outsideDir,
      path.join(extractedRoot, 'assets'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    let error = ''
    try {
      assertRegularArchiveTree(extractedRoot)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    assert(error.includes('symbolic links are not allowed'), '解压树必须拒绝目录链接或 Windows junction')
    assert(fs.readFileSync(sentinel, 'utf8') === 'keep', '检查目录链接时不得触碰链接目标')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testJournalZipEntryGuardRejectsTooManyEntries(): void {
  const guardEntry = createJournalZipEntryGuard({
    maxEntryCount: 2,
    maxEntryBytes: 100,
    maxExpandedBytes: 100,
  })
  guardEntry(zipEntry('first.json', 1))
  guardEntry(zipEntry('second.json', 1))

  let error = ''
  try {
    guardEntry(zipEntry('third.json', 1))
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  assert(error.includes('more than 2 entries'), '有界解压必须拒绝超过条目数量上限的归档')
}

export function testJournalZipEntryGuardRejectsOversizedEntry(): void {
  const guardEntry = createJournalZipEntryGuard({
    maxEntryCount: 10,
    maxEntryBytes: 5,
    maxExpandedBytes: 100,
  })

  let error = ''
  try {
    guardEntry(zipEntry('oversized.json', 6))
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  assert(error.includes('entry exceeds'), '有界解压必须拒绝超过单项解压上限的条目')
  assert(error.includes('oversized.json'), '单项上限错误必须标明被拒绝的条目')
}

export function testJournalZipEntryGuardRejectsExcessiveExpandedBytes(): void {
  const guardEntry = createJournalZipEntryGuard({
    maxEntryCount: 10,
    maxEntryBytes: 10,
    maxExpandedBytes: 10,
  })
  guardEntry(zipEntry('first.json', 6))

  let error = ''
  try {
    guardEntry(zipEntry('second.json', 5))
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  assert(error.includes('expanded archive exceeds'), '有界解压必须拒绝累计解压大小超过上限的归档')
}

export async function testArchiveImportRejectsOversizedSparseArchiveBeforeLibraryMutation(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-oversized-archive-'))
  const libraryRoot = path.join(root, 'library')
  const archive = path.join(root, 'oversized.journal.zip')
  const storage = new LibraryStorage(libraryRoot)
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const paths = storage.getPaths()
    const manifestBefore = fs.readFileSync(paths.manifestFile)
    const databaseBefore = fs.readFileSync(paths.dbFile)
    storage.release()

    const descriptor = fs.openSync(archive, 'w')
    try {
      fs.ftruncateSync(descriptor, MAX_DESKTOP_JOURNAL_ARCHIVE_BYTES + 1)
    } finally {
      fs.closeSync(descriptor)
    }

    let error = ''
    try {
      await importJournalZipToPath(libraryRoot, archive)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    assert(error.includes('compressed archive exceeds'), '导入必须拒绝超过压缩归档大小上限的文件')
    assert(fs.readFileSync(paths.manifestFile).equals(manifestBefore), '拒绝超大归档后 manifest 必须保持不变')
    assert(fs.readFileSync(paths.dbFile).equals(databaseBefore), '拒绝超大归档后数据库必须保持不变')
    assert(
      !fs.readdirSync(libraryRoot).some((name) => name.startsWith('.import-') || name.startsWith('.pre-import-')),
      '拒绝超大归档后不得残留导入或恢复目录',
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testArchiveImportRejectsStagingSymlinkWithoutTouchingOutside(): Promise<void> {
  if (process.platform === 'win32') return

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-staging-link-'))
  const libraryRoot = path.join(root, 'library')
  const outsideDir = path.join(root, 'outside')
  const sentinel = path.join(outsideDir, 'sentinel.txt')
  const archive = path.join(root, 'candidate.journal.zip')
  const storage = new LibraryStorage(libraryRoot)
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const paths = storage.getPaths()
    const databaseBefore = fs.readFileSync(paths.dbFile)
    storage.release()

    fs.mkdirSync(outsideDir)
    fs.writeFileSync(sentinel, 'keep', 'utf8')
    const zip = new JSZip()
    zip.file('data.json', JSON.stringify({
      version: WEB_JOURNAL_EXPORT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      ...emptySnapshot(),
      assets: [],
    }))
    zip.file('prepared/attachments', outsideDir, { unixPermissions: 0o120777 })
    fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))

    let error = ''
    try {
      await importJournalZipToPath(libraryRoot, archive)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    assert(error.includes('symbolic links are not allowed'), '导入必须在创建归档符号链接前拒绝它')
    assert(fs.readFileSync(sentinel, 'utf8') === 'keep', '恶意归档不得删除或覆盖库外文件')
    assert(fs.readFileSync(paths.dbFile).equals(databaseBefore), '拒绝恶意归档后当前资料库必须保持不变')
    assert(
      !fs.readdirSync(libraryRoot).some((name) => name.startsWith('.import-') || name.startsWith('.pre-import-')),
      '拒绝恶意归档后不得残留导入或恢复目录',
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testElectronWebImportRejectsDeclaredAssetWithoutNoteReference(): Promise<void> {
  const error = await captureImportError(
    {
      version: WEB_JOURNAL_EXPORT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      ...emptySnapshot(),
      assets: [{ id: 'unused-asset', mime: 'image/png' }],
    },
    { 'assets/unused-asset.png': new Uint8Array([1, 2, 3]) },
  )

  assert(error.includes('未被任何交易正文引用'), 'Electron 必须拒绝未被笔记引用的附件声明')
}

export async function testElectronWebImportRejectsAssetDeclarationAndFileMismatches(): Promise<void> {
  const snapshot = snapshotWithAsset('asset-one')
  const base = {
    version: WEB_JOURNAL_EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    ...snapshot,
  }
  const cases: Array<{
    payload: Record<string, unknown>
    files?: Record<string, Uint8Array | string>
    expected: string
  }> = [
    {
      payload: { ...base, assets: [] },
      expected: 'undeclared asset',
    },
    {
      payload: { ...base, assets: [{ id: 'asset-one', mime: 'image/png' }] },
      expected: 'declared asset is missing',
    },
    {
      payload: { ...base, assets: [{ id: 'asset-one', mime: 'image/png' }] },
      files: {
        'assets/asset-one.png': new Uint8Array([1]),
        'assets/extra.png': new Uint8Array([2]),
      },
      expected: 'asset file is not declared',
    },
    {
      payload: { ...base, assets: [{ id: 'asset-one', mime: 'image/png' }] },
      files: { 'assets/asset-one.jpg': new Uint8Array([1]) },
      expected: 'extension does not match',
    },
  ]

  for (const testCase of cases) {
    const error = await captureImportError(testCase.payload, testCase.files)
    assert(error.includes(testCase.expected), `附件契约不一致时必须拒绝：${testCase.expected}`)
  }
}

export async function testElectronWebImportKeepsValidDeclaredAssetBytes(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-valid-asset-'))
  const archive = path.join(root, 'candidate.journal.zip')
  const assetBytes = new Uint8Array([0, 1, 2, 3, 255])
  let storage: LibraryStorage | null = null
  try {
    await writeWebArchive(
      archive,
      {
        version: WEB_JOURNAL_EXPORT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        ...snapshotWithAsset('asset-vendor'),
        assets: [{ id: 'asset-vendor', mime: 'image/x-linear-capture' }],
      },
      { 'assets/asset-vendor.bin': assetBytes },
    )

    await importJournalZipToPath(root, archive)
    storage = new LibraryStorage(root)
    await storage.open()
    const restored = storage.getAssetBytes('asset-vendor')
    assert(restored?.mime === 'image/x-linear-capture', '有效 image/* MIME 必须原样保留')
    assert(
      Buffer.from(restored?.bytes ?? []).equals(Buffer.from(assetBytes)),
      '有效声明附件的原始字节必须无损导入',
    )
  } finally {
    storage?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testElectronWebImportRepairsMissingStrategyReferences(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-strategy-repair-'))
  const archive = path.join(root, 'candidate.journal.zip')
  let storage: LibraryStorage | null = null
  try {
    const trade = {
      ...snapshotWithAsset('unused').trades[0],
      id: 'trade-with-missing-strategy',
      ref: 'TRD-STRATEGY',
      strategyId: 'removed-strategy',
      note: '',
    }
    await writeWebArchive(archive, {
      version: WEB_JOURNAL_EXPORT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      ...emptySnapshot(),
      trades: [trade],
      assets: [],
    })

    await importJournalZipToPath(root, archive)
    storage = new LibraryStorage(root)
    await storage.open()
    const restored = storage.loadSnapshot()
    assert(restored !== null, '导入后必须能够加载快照')
    assert(restored.strategies.length > 0, '存在记录时必须物化一个真实策略')
    assert(
      restored.trades[0]?.strategyId === restored.strategies[0]?.id,
      '未知策略引用必须修复为资料库中真实存在的策略 ID',
    )
  } finally {
    storage?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

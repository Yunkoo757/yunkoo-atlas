import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import initSqlJs from 'sql.js'
import JSZip from 'jszip'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import { buildWebJournalArchiveBlob } from '../../src/lib/importExport'
import { WEB_JOURNAL_EXPORT_VERSION } from '../../src/lib/webJournalArchiveContract'
import {
  parseWebJournalArchive,
  WebJournalArchiveError,
} from '../../src/lib/webJournalArchive'
import { SCHEMA_VERSION, type PersistedSnapshot } from '../../src/storage/types'
import { PERSISTED_SNAPSHOT_FIELDS } from '../../src/storage/persistedKeys'
import {
  createFullPersistedSnapshotFixture,
  FULL_SNAPSHOT_ASSET_IDS,
  canonicalContractJson,
} from '../../src/storage/fixtures/fullPersistedSnapshot'
import {
  MAX_DESKTOP_JOURNAL_ARCHIVE_BYTES,
  assertRegularArchiveTree,
  createJournalZipEntryGuard,
  exportJournalZip,
  importJournalZipToPath,
  validateLibraryDatabaseFile,
  validateDesktopLibrary,
} from './journalZip'
import { LibraryStorage } from './storage'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function emptySnapshot(): PersistedSnapshot {
  return {
    ...createEmptyPersistedSnapshot(),
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }
}

function snapshotWithAsset(assetId: string): PersistedSnapshot {
  const base = emptySnapshot()
  return {
    ...base,
    trades: [{
      id: 'trade-with-asset',
      ref: 'TRD-ASSET',
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'open',
      conviction: 'medium',
      strategyId: 'uncategorized',
      tradeKind: 'live',
      liveStageId: base.currentLiveStageId,
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

function snapshotWithCaseSourceAsset(assetId: string): PersistedSnapshot {
  const next = snapshotWithAsset(assetId)
  const source = next.trades[0]!
  return {
    ...next,
    trades: [{
      ...source,
      id: 'case-with-source-asset',
      ref: 'CAS-SOURCE-ASSET',
      tradeKind: 'case',
      sourceTradeId: 'source-trade',
      note: '',
      sourceNoteHtml: `<img src="journal-asset://${assetId}">`,
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

export async function testDesktopArchiveNormalizesMissingHistoricalRuntimeIdCollections(): Promise<void> {
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

    await validateDesktopLibrary(paths)
    const reopened = new LibraryStorage(root)
    await reopened.open()
    try {
      assert(
        JSON.stringify(reopened.loadSnapshot()?.subscribedIds) === '[]',
        '历史 v8 缺省运行时 ID 集合必须只由中央 codec 补齐',
      )
    } finally {
      reopened.release()
    }
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
        assets: [{ id: 'asset-vendor', mime: 'image/x-atlas-capture' }],
      },
      { 'assets/asset-vendor.bin': assetBytes },
    )

    await importJournalZipToPath(root, archive)
    storage = new LibraryStorage(root)
    await storage.open()
    const restored = storage.getAssetBytes('asset-vendor')
    assert(restored?.mime === 'image/x-atlas-capture', '有效 image/* MIME 必须原样保留')
    assert(
      Buffer.from(restored?.bytes ?? []).equals(Buffer.from(assetBytes)),
      '有效声明附件的原始字节必须无损导入',
    )
  } finally {
    storage?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testElectronWebImportKeepsCaseSourceSnapshotOnlyAsset(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-case-source-'))
  const archive = path.join(root, 'candidate.journal.zip')
  const assetBytes = new Uint8Array([9, 8, 7, 6])
  let storage: LibraryStorage | null = null
  try {
    await writeWebArchive(
      archive,
      {
        version: WEB_JOURNAL_EXPORT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        ...snapshotWithCaseSourceAsset('case-source-only'),
        assets: [{ id: 'case-source-only', mime: 'image/png' }],
      },
      { 'assets/case-source-only.png': assetBytes },
    )

    await importJournalZipToPath(root, archive)
    storage = new LibraryStorage(root)
    await storage.open()
    assert(
      storage.loadSnapshot()?.trades[0]?.sourceNoteHtml?.includes('case-source-only'),
      'Electron Web 归档必须保留案例来源快照引用',
    )
    assert(
      Buffer.from(storage.getAssetBytes('case-source-only')?.bytes ?? []).equals(Buffer.from(assetBytes)),
      'Electron Web 归档必须保留仅由案例来源快照引用的附件字节',
    )
  } finally {
    storage?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testElectronWebImportRejectsMissingCaseSourceSnapshotAsset(): Promise<void> {
  const error = await captureImportError({
    version: WEB_JOURNAL_EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    ...snapshotWithCaseSourceAsset('missing-case-source'),
    assets: [],
  })

  assert(
    error.includes('undeclared asset'),
    'Electron Web 归档必须拒绝来源快照引用但未声明的附件',
  )
}

export async function testLibraryDatabaseValidationIncludesCaseSourceSnapshotAsset(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-db-case-source-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.importAsset('case-source-db', 'image/png', Buffer.from('case-source-db-image'))
    storage.saveSnapshot(snapshotWithCaseSourceAsset('case-source-db'))

    const inspection = await validateLibraryDatabaseFile(storage.getPaths().dbFile, {
      schemaVersion: SCHEMA_VERSION,
    })
    assert(
      inspection.referencedAssetIds.join(',') === 'case-source-db',
      'library DB 校验必须收集仅由案例来源快照引用的附件',
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testLibraryDatabaseValidationRejectsMissingCaseSourceSnapshotAsset(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-db-missing-case-source-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(snapshotWithCaseSourceAsset('missing-case-source-db'))

    let error = ''
    try {
      await validateLibraryDatabaseFile(storage.getPaths().dbFile, {
        schemaVersion: SCHEMA_VERSION,
      })
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    assert(
      error.includes('snapshot references a missing asset'),
      'library DB 校验必须拒绝来源快照引用但物理记录缺失的附件',
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testLibraryDatabaseValidationDeduplicatesSharedCaseAsset(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-db-shared-case-source-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.importAsset('shared-case-asset', 'image/png', Buffer.from('shared-case-image'))
    const next = snapshotWithCaseSourceAsset('shared-case-asset')
    next.trades[0]!.note = '<img src="journal-asset://shared-case-asset">'
    storage.saveSnapshot(next)

    const inspection = await validateLibraryDatabaseFile(storage.getPaths().dbFile, {
      schemaVersion: SCHEMA_VERSION,
    })
    assert(
      inspection.referencedAssetIds.join(',') === 'shared-case-asset',
      '正文与来源快照共享附件时 library DB 校验只能收集一个 ID',
    )
  } finally {
    storage.release()
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

export async function testElectronWebImportUsesCanonicalDefaultsForMissingHistoricalFields(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-canonical-defaults-'))
  const archive = path.join(root, 'candidate.journal.zip')
  let storage: LibraryStorage | null = null
  try {
    await writeWebArchive(archive, {
      version: 1,
      schemaVersion: 1,
      assets: [],
    })
    await importJournalZipToPath(root, archive)
    storage = new LibraryStorage(root)
    await storage.open()
    const snapshot = storage.loadSnapshot()
    assert(snapshot !== null, '历史 Web 归档导入后必须产生 canonical snapshot')
    assert(snapshot.trades.length === 0, '缺失 trades 必须由中央 codec 补为空数组')
    assert(snapshot.strategies.length > 0, '缺失 strategies 必须由中央 codec 补既有默认策略')
    for (const field of PERSISTED_SNAPSHOT_FIELDS) {
      assert(snapshot[field] !== undefined, `Electron PATH-C 历史缺省字段 ${field} 必须显式存在`)
    }
  } finally {
    storage?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testElectronExactImportDecodesHistoricalDatabaseWithManifestVersion(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-exact-historical-codec-'))
  const sourceRoot = path.join(root, 'source')
  const targetRoot = path.join(root, 'target')
  const archive = path.join(root, 'historical.journal.zip')
  let source: LibraryStorage | null = null
  let target: LibraryStorage | null = null
  try {
    source = new LibraryStorage(sourceRoot)
    await source.open()
    source.saveSnapshot(emptySnapshot())
    source.writeManifest({ ...source.readManifest(), schemaVersion: 1 })
    await exportJournalZip(source, archive)

    await importJournalZipToPath(targetRoot, archive)
    target = new LibraryStorage(targetRoot)
    await target.open()
    const restored = target.loadSnapshot()
    assert(restored !== null, '历史 exact archive 必须可由 manifest 版本驱动中央 codec 读取')
    for (const field of PERSISTED_SNAPSHOT_FIELDS) {
      assert(restored[field] !== undefined, `Electron PATH-D 历史字段 ${field} 必须规范化为 canonical`)
    }
  } finally {
    source?.release()
    target?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function libraryChecksum(root: string): string {
  const hash = createHash('sha256')
  const visit = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })
      .filter((item) => !item.name.startsWith('.import-') && !item.name.startsWith('.pre-import-'))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = path.join(dir, entry.name)
      const relative = path.relative(root, fullPath).replace(/\\/g, '/')
      hash.update(relative)
      if (entry.isDirectory()) visit(fullPath)
      else hash.update(fs.readFileSync(fullPath))
    }
  }
  visit(root)
  return hash.digest('hex')
}

export async function testPathCProductionWebWriterPreservesAllFieldsAndAttachmentsInElectron(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-content-contract-'))
  const archive = path.join(root, 'candidate.journal.zip')
  let storage: LibraryStorage | null = null
  try {
    const expected = createFullPersistedSnapshotFixture()
    const assetBytes = new Map(
      Object.values(FULL_SNAPSHOT_ASSET_IDS).map(
        (id, index) => [id, new Uint8Array([index, 11, 22, 33, 44])],
      ),
    )
    const webArchive = buildWebJournalArchiveBlob(
      expected,
      [...assetBytes].map(([id, bytes]) => ({
        id,
        mime: 'image/png',
        data: Buffer.from(bytes).toString('base64'),
      })),
    )
    fs.writeFileSync(archive, Buffer.from(await webArchive.arrayBuffer()))

    await importJournalZipToPath(root, archive)
    storage = new LibraryStorage(root)
    await storage.open()
    const restored = storage.loadSnapshot()
    assert(restored !== null, '导入后必须能够加载快照')
    for (const field of PERSISTED_SNAPSHOT_FIELDS) {
      assert(
        canonicalContractJson(restored[field]) === canonicalContractJson(expected[field]),
        `PATH-C Electron Web reader 字段 ${field} 必须逐字段保真`,
      )
    }
    for (const [id, bytes] of assetBytes) {
      const restoredAsset = storage.getAssetBytes(id)
      assert(restoredAsset?.mime === 'image/png', `PATH-C 附件 ${id} 必须保留 MIME`)
      assert(
        Buffer.from(restoredAsset?.bytes ?? []).equals(Buffer.from(bytes)),
        `PATH-C 附件 ${id} 必须逐字节保真`,
      )
    }
  } finally {
    storage?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testPathDElectronExactArchiveRoundTripsFullSnapshotAndAttachments(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-exact-contract-'))
  const sourceRoot = path.join(root, 'source')
  const targetRoot = path.join(root, 'target')
  const archive = path.join(root, 'exact.journal.zip')
  const source = new LibraryStorage(sourceRoot)
  let target: LibraryStorage | null = null
  try {
    await source.open()
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const ids = {
      trade: await source.saveAssetAsync(image, 'image/png'),
      weeklyReview: await source.saveAssetAsync(image, 'image/png'),
      quickNote: await source.saveAssetAsync(image, 'image/png'),
      shared: await source.saveAssetAsync(image, 'image/png'),
    }
    const expected = createFullPersistedSnapshotFixture(ids)
    source.saveSnapshot(expected)
    const sourceManifest = source.readManifest()
    const sourceAssets = new Map(
      Object.values(ids).map((id) => [id, source.getAssetBytes(id)]),
    )
    const sourceDatabaseBytes = fs.readFileSync(source.getPaths().dbFile)

    await exportJournalZip(source, archive)
    const exactArchiveBytes = fs.readFileSync(archive)
    const exactArchiveArrayBuffer = exactArchiveBytes.buffer.slice(
      exactArchiveBytes.byteOffset,
      exactArchiveBytes.byteOffset + exactArchiveBytes.byteLength,
    ) as ArrayBuffer
    let webReject: unknown
    try {
      await parseWebJournalArchive(exactArchiveArrayBuffer)
    } catch (error) {
      webReject = error
    }
    assert(
      webReject instanceof WebJournalArchiveError
        && webReject.code === 'desktop-format-not-supported-on-web',
      '真实 PATH-D writer 产物交给 Web reader 时必须返回稳定的不支持错误码',
    )
    source.release()
    await importJournalZipToPath(targetRoot, archive)

    assert(
      fs.readFileSync(new LibraryStorage(targetRoot).getPaths().dbFile).equals(sourceDatabaseBytes),
      'PATH-D journal.db 必须逐字节精确往返',
    )

    target = new LibraryStorage(targetRoot)
    await target.open()
    const restored = target.loadSnapshot()
    assert(restored !== null, 'PATH-D exact reader 必须恢复快照')
    for (const field of PERSISTED_SNAPSHOT_FIELDS) {
      assert(
        canonicalContractJson(restored[field]) === canonicalContractJson(expected[field]),
        `PATH-D 字段 ${field} 必须逐字段保真`,
      )
    }
    assert(
      JSON.stringify(target.readManifest()) === JSON.stringify(sourceManifest),
      'PATH-D manifest 必须精确往返',
    )
    for (const [id, expectedAsset] of sourceAssets) {
      const restoredAsset = target.getAssetBytes(id)
      assert(restoredAsset?.mime === expectedAsset?.mime, `PATH-D 附件 ${id} 必须保留 MIME`)
      assert(
        Buffer.from(restoredAsset?.bytes ?? []).equals(Buffer.from(expectedAsset?.bytes ?? [])),
        `PATH-D 附件 ${id} 必须逐字节保真`,
      )
    }
  } finally {
    source.release()
    target?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testWebArchiveImportPreservesAnExistingLibraryIdentity(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-web-identity-'))
  const libraryRoot = path.join(root, 'library')
  const archive = path.join(root, 'web.journal.zip')
  const storage = new LibraryStorage(libraryRoot)
  let reopened: LibraryStorage | null = null
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const originalLibraryId = storage.readManifest().libraryId
    storage.release()
    await writeWebArchive(archive, {
      version: WEB_JOURNAL_EXPORT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      ...emptySnapshot(),
      assets: [],
    })

    await importJournalZipToPath(libraryRoot, archive)
    reopened = new LibraryStorage(libraryRoot)
    await reopened.open()

    assert(
      reopened.readManifest().libraryId === originalLibraryId,
      'Web 归档替换已有资料库时必须保留配置所绑定的 libraryId',
    )
  } finally {
    storage.release()
    reopened?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testInterruptedJournalImportRestoresThePreviousLibraryOnOpen(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-import-recovery-'))
  const libraryRoot = path.join(root, 'library')
  const storage = new LibraryStorage(libraryRoot)
  let reopened: LibraryStorage | null = null
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const paths = storage.getPaths()
    storage.release()

    const databaseBefore = fs.readFileSync(paths.dbFile)
    const manifestBefore = fs.readFileSync(paths.manifestFile)
    const recoveryDirName = '.pre-import-interrupted-test'
    const recoveryDir = path.join(libraryRoot, recoveryDirName)
    fs.mkdirSync(path.join(recoveryDir, 'attachments'), { recursive: true })
    fs.copyFileSync(paths.dbFile, path.join(recoveryDir, 'journal.db'))
    fs.copyFileSync(paths.manifestFile, path.join(recoveryDir, 'manifest.json'))
    fs.writeFileSync(path.join(libraryRoot, '.journal-import.json'), JSON.stringify({
      version: 1,
      recoveryDir: recoveryDirName,
      hadDatabase: true,
      hadManifest: true,
      databaseSha256: createHash('sha256').update(databaseBefore).digest('hex'),
      manifestSha256: createHash('sha256').update(manifestBefore).digest('hex'),
      attachmentEntries: [],
    }))
    fs.writeFileSync(paths.dbFile, 'interrupted replacement')

    reopened = new LibraryStorage(libraryRoot)
    await reopened.open()
    assert(fs.readFileSync(paths.dbFile).equals(databaseBefore), '启动恢复必须还原导入前数据库')
    assert(fs.readFileSync(paths.manifestFile).equals(manifestBefore), '启动恢复必须还原导入前 manifest')
    assert(!fs.existsSync(path.join(libraryRoot, '.journal-import.json')), '恢复成功后必须清除导入标记')
    assert(!fs.existsSync(recoveryDir), '恢复成功后必须清除导入恢复副本')
  } finally {
    storage.release()
    reopened?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testDesktopArchiveImportPreservesAnExistingLibraryIdentity(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-desktop-identity-'))
  const sourceRoot = path.join(root, 'source')
  const targetRoot = path.join(root, 'target')
  const archive = path.join(root, 'desktop.journal.zip')
  const source = new LibraryStorage(sourceRoot)
  const target = new LibraryStorage(targetRoot)
  let reopened: LibraryStorage | null = null
  try {
    await source.open()
    source.saveSnapshot(emptySnapshot())
    await target.open()
    target.saveSnapshot(emptySnapshot())
    const targetLibraryId = target.readManifest().libraryId
    await exportJournalZip(source, archive)
    source.release()
    target.release()

    await importJournalZipToPath(targetRoot, archive)
    reopened = new LibraryStorage(targetRoot)
    await reopened.open()
    assert(
      reopened.readManifest().libraryId === targetLibraryId,
      '桌面归档替换已有资料库时必须保留配置所绑定的 libraryId',
    )
  } finally {
    source.release()
    target.release()
    reopened?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testCorruptJournalImportRecoveryFailsClosedBeforeLibraryMutation(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-import-corrupt-recovery-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const paths = storage.getPaths()
    storage.release()
    const databaseBefore = fs.readFileSync(paths.dbFile)
    const manifestBefore = fs.readFileSync(paths.manifestFile)
    const recoveryDirName = '.pre-import-corrupt-test'
    const recoveryDir = path.join(root, recoveryDirName)
    fs.mkdirSync(path.join(recoveryDir, 'attachments'), { recursive: true })
    fs.copyFileSync(paths.dbFile, path.join(recoveryDir, 'journal.db'))
    fs.copyFileSync(paths.manifestFile, path.join(recoveryDir, 'manifest.json'))
    fs.writeFileSync(path.join(root, '.journal-import.json'), JSON.stringify({
      version: 1,
      recoveryDir: recoveryDirName,
      hadDatabase: true,
      hadManifest: true,
      databaseSha256: '0'.repeat(64),
      manifestSha256: createHash('sha256').update(manifestBefore).digest('hex'),
      attachmentEntries: [],
    }))

    const candidate = new LibraryStorage(root)
    let rejected = false
    try {
      await candidate.open()
    } catch {
      rejected = true
    } finally {
      candidate.release()
    }
    assert(rejected, '损坏的导入恢复副本必须阻止资料库打开')
    assert(fs.readFileSync(paths.dbFile).equals(databaseBefore), '拒绝损坏恢复副本前不得修改数据库')
    assert(fs.readFileSync(paths.manifestFile).equals(manifestBefore), '拒绝损坏恢复副本前不得修改 manifest')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testDesktopExportOmitsUncommittedAttachmentFiles(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-export-orphan-'))
  const sourceRoot = path.join(root, 'source')
  const targetRoot = path.join(root, 'target')
  const archive = path.join(root, 'clean.journal.zip')
  const source = new LibraryStorage(sourceRoot)
  let target: LibraryStorage | null = null
  try {
    await source.open()
    source.saveSnapshot(emptySnapshot())
    fs.writeFileSync(path.join(source.getPaths().attachments, 'orphan.tmp'), 'uncommitted', 'utf8')

    await exportJournalZip(source, archive)
    await importJournalZipToPath(targetRoot, archive)
    target = new LibraryStorage(targetRoot)
    await target.open()

    assert(target.loadSnapshot() !== null, '含磁盘孤儿的活动库仍必须导出可恢复归档')
    assert(
      !fs.existsSync(path.join(target.getPaths().attachments, 'orphan.tmp')),
      '数据库未声明的附件不得进入桌面归档',
    )
  } finally {
    source.release()
    target?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testFailedDesktopExportPreservesExistingDestination(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-export-atomic-'))
  const libraryRoot = path.join(root, 'library')
  const destination = path.join(root, 'existing.journal.zip')
  const storage = new LibraryStorage(libraryRoot)
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    fs.writeFileSync(destination, 'previous-valid-archive', 'utf8')
    fs.rmSync(storage.getPaths().manifestFile)

    let rejected = false
    try {
      await exportJournalZip(storage, destination)
    } catch {
      rejected = true
    }

    assert(rejected, '源资料库不完整时导出必须失败')
    assert(
      fs.readFileSync(destination, 'utf8') === 'previous-valid-archive',
      '导出失败不得截断用户已有归档',
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testDesktopExportAtomicallyReplacesAnExistingArchive(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-export-replace-'))
  const destination = path.join(root, 'existing.journal.zip')
  const targetRoot = path.join(root, 'target')
  const storage = new LibraryStorage(path.join(root, 'source'))
  let target: LibraryStorage | null = null
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    fs.writeFileSync(destination, 'old archive bytes', 'utf8')

    await exportJournalZip(storage, destination)
    await importJournalZipToPath(targetRoot, destination)
    target = new LibraryStorage(targetRoot)
    await target.open()
    assert(target.loadSnapshot() !== null, '成功导出必须原子替换已有归档且保持可恢复')
  } finally {
    storage.release()
    target?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testDesktopExportRenameFailureCleansTemporaryArchive(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-export-rename-failure-'))
  const destination = path.join(root, 'existing.journal.zip')
  const sentinel = path.join(destination, 'keep.txt')
  const storage = new LibraryStorage(path.join(root, 'source'))
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    fs.mkdirSync(destination)
    fs.writeFileSync(sentinel, 'keep', 'utf8')

    let rejected = false
    try {
      await exportJournalZip(storage, destination)
    } catch {
      rejected = true
    }
    assert(rejected, '目标无法替换时导出必须失败')
    assert(fs.readFileSync(sentinel, 'utf8') === 'keep', '替换失败不得破坏原目标')
    assert(
      !fs.readdirSync(root).some((name) => name.startsWith('.existing.journal.zip.') && name.endsWith('.tmp')),
      '替换失败后不得遗留临时归档',
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testDesktopExportRejectsTargetsInsideTheActiveLibrary(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-export-self-overwrite-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    const paths = storage.getPaths()
    const databaseBefore = fs.readFileSync(paths.dbFile)

    let rejected = false
    try {
      await exportJournalZip(storage, paths.dbFile)
    } catch {
      rejected = true
    }
    assert(rejected, '导出不得把活动资料库文件选作目标')
    assert(fs.readFileSync(paths.dbFile).equals(databaseBefore), '拒绝自覆盖时数据库必须逐字节不变')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testPathCThirdAttachmentWriteFailureLeavesCurrentLibraryByteIdentical(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-journal-web-write-failure-'))
  const libraryRoot = path.join(root, 'library')
  const archive = path.join(root, 'candidate.journal.zip')
  const storage = new LibraryStorage(libraryRoot)
  try {
    await storage.open()
    storage.saveSnapshot(emptySnapshot())
    await storage.saveAssetAsync(Buffer.from('current-library-asset'), 'application/octet-stream')
    storage.release()
    const checksumBefore = libraryChecksum(libraryRoot)

    const candidate = createFullPersistedSnapshotFixture()
    const files = Object.fromEntries(
      Object.values(FULL_SNAPSHOT_ASSET_IDS).map((id, index) => [
        `assets/${id}.png`,
        new Uint8Array([index, 91, 92, 93]),
      ]),
    )
    await writeWebArchive(archive, {
      version: WEB_JOURNAL_EXPORT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      ...candidate,
      assets: Object.values(FULL_SNAPSHOT_ASSET_IDS).map((id) => ({ id, mime: 'image/png' })),
    }, files)

    let rejected = false
    try {
      await importJournalZipToPath(libraryRoot, archive, {
        copyWebAsset(source, destination, index) {
          if (index === 2) throw new Error('forced third attachment write failure')
          fs.copyFileSync(source, destination)
        },
      })
    } catch (error) {
      rejected = error instanceof Error && error.message.includes('third attachment')
    }

    assert(rejected, 'PATH-C 第三个附件写入失败必须拒绝整个导入')
    assert(
      libraryChecksum(libraryRoot) === checksumBefore,
      'PATH-C 第三个附件失败后 manifest、DB、快照与附件校验和必须零变化',
    )
    assert(
      !fs.readdirSync(libraryRoot).some((name) => name.startsWith('.import-') || name.startsWith('.pre-import-')),
      'PATH-C 失败后不得残留 staging 或恢复目录',
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
// Quality-Scenario: H0-C-16
// Quality-Scenario: H0-D-16

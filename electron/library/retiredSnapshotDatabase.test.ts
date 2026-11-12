import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import initSqlJs from 'sql.js'
import JSZip from 'jszip'
import { createFullPersistedSnapshotFixture } from '../../src/storage/fixtures/fullPersistedSnapshot'
import { stripRetiredSnapshotDomains } from '../../src/storage/retiredSnapshotDomains'
import { createBackupAtPath, restoreBackupAtPath, verifyBackupAtPath } from './backup'
import { exportJournalZip, importJournalZipToPath, installPreparedLibraryAtPath } from './journalZip'
import { retiredSnapshotDatabaseBytes } from './retiredSnapshotDatabase'
import { LibraryStorage } from './storage'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const sqlRuntime = () => initSqlJs({ locateFile: () => path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm') })
const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function inspect(bytes: Buffer) {
  const SQL = await sqlRuntime()
  const db = new SQL.Database(Buffer.from(bytes))
  try {
    const meta = Object.fromEntries((db.exec('SELECT key, value FROM meta')[0]?.values ?? []).map(row => [String(row[0]), String(row[1])]))
    return { meta, snapshot: JSON.parse(meta.snapshot) as Record<string, unknown>, assets: db.exec('SELECT * FROM assets')[0]?.values ?? [] }
  } finally { db.close() }
}

async function rawRetiredLibrary(root: string) {
  let storage = new LibraryStorage(root)
  await storage.open()
  const snapshot = createFullPersistedSnapshotFixture()
  snapshot.trades[0]!.note = '<p>必须原样保留的交易正文</p><img src="journal-asset://shared-native">'
  snapshot.weeklyReviews = []
  snapshot.quickNotes = []
  storage.importAsset('shared-native', 'image/png', Buffer.from('shared-original'))
  storage.importAsset('retired-native', 'image/png', Buffer.from('retired-original'))
  storage.saveSnapshot(snapshot)
  storage.release()
  const raw = {
    ...snapshot,
    judgmentDesk: { samples: [{ images: [{ assetId: 'shared-native' }, { assetId: 'retired-native' }] }] },
    reviewComposer: { draft: '旧组合器专属草稿' },
    shortcuts: { ...snapshot.shortcuts, 'judgment.yes': { key: 'y' } },
    display: { ...snapshot.display, sidebarPrimaryOrder: ['trades', 'judgmentDesk', 'reviewComposer'], workspaceMemory: { judgmentDesk: { pathname: '/judgment-desk' } } },
  }
  const SQL = await sqlRuntime()
  const db = new SQL.Database(fs.readFileSync(path.join(root, 'journal.db')))
  db.run("UPDATE meta SET value = ? WHERE key = 'snapshot'", [JSON.stringify(raw)])
  db.run("INSERT INTO meta (key, value) VALUES ('snapshotRevision', '17') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  db.run("INSERT INTO meta (key, value) VALUES ('retained-meta', '原样保留')")
  fs.writeFileSync(path.join(root, 'journal.db'), Buffer.from(db.export()))
  db.close()
  storage = new LibraryStorage(root, { allowCreate: false })
  await storage.open()
  return { storage, raw }
}

export async function testRetiredSqlCandidatePreservesExactCleanBytesAndOnlyChangesSnapshot(): Promise<void> {
  const SQL = await sqlRuntime()
  const db = new SQL.Database()
  try {
    db.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE assets (id TEXT PRIMARY KEY, sentinel TEXT);')
    db.run("INSERT INTO meta VALUES ('schemaVersion', '15'), ('snapshotRevision', '31'), ('retained-meta', '保留')")
    db.run("INSERT INTO assets VALUES ('shared', 'keep-attachment-metadata')")
    const active = { trades: [{ id: 'record', note: 'judgmentDesk 是交易正文中的普通文字' }], shortcuts: { 'nav.dashboard': { key: 'd' } } }
    db.run("INSERT INTO meta VALUES ('snapshot', ?)", [JSON.stringify(active, null, 2)])
    const clean = Buffer.from(db.export())
    assert(retiredSnapshotDatabaseBytes(clean, SQL.Database) === clean, '无退役状态时应返回原数据库字节，不改写精确备份')
    for (const raw of [
      { ...active, judgmentDesk: { obsolete: true }, reviewComposer: 'obsolete' },
      { ...active, shortcuts: { ...active.shortcuts, 'nav.judgmentDesk': { key: 'j' } } },
    ]) {
      db.run("UPDATE meta SET value = ? WHERE key = 'snapshot'", [JSON.stringify(raw)])
      const original = Buffer.from(db.export())
      const before = await inspect(original)
      const cleaned = await inspect(retiredSnapshotDatabaseBytes(original, SQL.Database))
      assert(JSON.stringify(cleaned.snapshot) === JSON.stringify(stripRetiredSnapshotDomains(raw)), 'SQL候选应只应用明确的退役状态与导航清理')
      assert(cleaned.meta.schemaVersion === before.meta.schemaVersion && cleaned.meta.snapshotRevision === before.meta.snapshotRevision && cleaned.meta['retained-meta'] === before.meta['retained-meta'], '清理不得改schema、revision或其他meta')
      assert(JSON.stringify(cleaned.assets) === JSON.stringify(before.assets), '清理不得改附件索引')
      assert((await inspect(original)).meta.snapshot === before.meta.snapshot, '清理不得改输入数据库字节')
    }
  } finally { db.close() }
}

export async function testNewBackupAndHistoricalRestoreRetireStateWithoutEditingTheirSources(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-retired-backup-candidate-'))
  let storage: LibraryStorage | undefined
  try {
    const fixture = await rawRetiredLibrary(root)
    storage = fixture.storage
    const original = fs.readFileSync(storage.getPaths().dbFile)
    const originalManifest = fs.readFileSync(storage.getPaths().manifestFile)
    const exported = storage.exportSnapshotDatabaseBytes()
    assert(fs.readFileSync(storage.getPaths().dbFile).equals(original) && storage.getSnapshotRevision() === 17, '只读候选不得写源库或推进revision')
    assert(!('judgmentDesk' in (await inspect(exported)).snapshot), '只读导出候选必须剥离退役状态')
    const backup = createBackupAtPath(storage, root, Date.UTC(2026, 10, 12, 12))!
    const backupBytes = fs.readFileSync(backup)
    const meta = JSON.parse(fs.readFileSync(backup + '.meta.json', 'utf8'))
    assert(!('reviewComposer' in (await inspect(backupBytes)).snapshot), '后台新备份不依赖renderer另存即可清理退役状态')
    assert(meta.databaseSha256 === checksum(backupBytes) && meta.librarySizeBytes === backupBytes.byteLength, '新备份hash和大小必须来自清理后的目标字节')
    assert((await verifyBackupAtPath(root, path.basename(backup))).status === 'verified', '清理后的新备份必须通过原有完整验证')
    assert(fs.readFileSync(storage.getPaths().dbFile).equals(original), '备份创建与验证不得改来源DB')
    const historical = createBackupAtPath({
      getCounts: () => storage!.getCounts(), listCommittedAttachmentFileNames: () => storage!.listCommittedAttachmentFileNames(),
      exportSnapshotDatabaseBytes: () => original,
    }, root, Date.UTC(2026, 10, 12, 11))!
    const historicalMeta = fs.readFileSync(historical + '.meta.json')
    const cleaner = storage.createSnapshotDatabaseCleaner()
    storage.release()
    storage = undefined
    assert(restoreBackupAtPath(root, path.basename(historical), cleaner), '历史备份应沿原恢复协议成功安装清理候选')
    const restored = await inspect(fs.readFileSync(path.join(root, 'journal.db')))
    assert(!('judgmentDesk' in restored.snapshot) && !('reviewComposer' in restored.snapshot), '恢复提交后无需renderer保存，磁盘就不得带回退役状态')
    assert(restored.meta.snapshotRevision === '17' && restored.meta.schemaVersion === '15', '历史备份清理不得改版本或revision')
    assert(fs.readFileSync(historical).equals(original) && fs.readFileSync(historical + '.meta.json').equals(historicalMeta), '历史备份及其hash元数据不得改写')
    assert(fs.readFileSync(path.join(root, 'manifest.json')).equals(originalManifest), '候选清理不得改manifest')
    assert(fs.readFileSync(path.join(root, 'attachments/shared-native.png')).toString() === 'shared-original' && fs.readFileSync(path.join(root, 'attachments/retired-native.png')).toString() === 'retired-original', '恢复清理不得删除或改写任何物理附件')
  } finally {
    storage?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testNativeArchiveAndPrivateRestoreCandidatesRetireOnlyCopiedState(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-retired-native-candidate-'))
  let storage: LibraryStorage | undefined
  try {
    const sourceRoot = path.join(root, 'source')
    const fixture = await rawRetiredLibrary(sourceRoot)
    storage = fixture.storage
    const sourceBytes = fs.readFileSync(storage.getPaths().dbFile)
    const manifestBytes = fs.readFileSync(storage.getPaths().manifestFile)
    const cleanArchive = path.join(root, 'new.journal.zip')
    await exportJournalZip(storage, cleanArchive)
    const exportedZip = await JSZip.loadAsync(fs.readFileSync(cleanArchive))
    const exported = await inspect(await exportedZip.file('journal.db')!.async('nodebuffer'))
    assert(!('judgmentDesk' in exported.snapshot) && !('reviewComposer' in exported.snapshot), '原生导出必须清理DB副本而不依赖renderer保存')
    assert((await exportedZip.file('manifest.json')!.async('nodebuffer')).equals(manifestBytes), '原生导出不得改manifest')
    for (const version of [13, 14, 15]) {
      const SQL = await sqlRuntime()
      const oldDb = new SQL.Database(Buffer.from(sourceBytes))
      oldDb.run("UPDATE meta SET value = ? WHERE key = 'schemaVersion'", [String(version)])
      const rawDatabase = Buffer.from(oldDb.export())
      oldDb.close()
      const rawArchive = path.join(root, `old-v${version}.journal.zip`)
      const zip = new JSZip()
      zip.file('manifest.json', JSON.stringify({ ...JSON.parse(manifestBytes.toString()), schemaVersion: version }))
      zip.file('journal.db', rawDatabase)
      for (const file of ['shared-native.png', 'retired-native.png']) zip.file(`attachments/${file}`, fs.readFileSync(path.join(sourceRoot, 'attachments', file)))
      fs.writeFileSync(rawArchive, await zip.generateAsync({ type: 'nodebuffer' }))
      const rawArchiveBytes = fs.readFileSync(rawArchive)
      const target = path.join(root, `restored-v${version}`)
      await importJournalZipToPath(target, rawArchive)
      const restored = await inspect(fs.readFileSync(path.join(target, 'journal.db')))
      assert(!('judgmentDesk' in restored.snapshot) && !('reviewComposer' in restored.snapshot), '原生旧归档安装后必须立即清理磁盘退役状态')
      assert(restored.meta.schemaVersion === String(version) && restored.meta.snapshotRevision === '17', '私有候选清理不得偷偷迁移schema或revision')
      assert(fs.readFileSync(rawArchive).equals(rawArchiveBytes), '原生恢复不得改写用户原归档')
      assert(fs.readFileSync(path.join(target, 'attachments/shared-native.png')).toString() === 'shared-original', '原生候选必须保留共享附件')
    }
    const prepared = path.join(root, 'private-prepared')
    fs.cpSync(sourceRoot, prepared, { recursive: true })
    const installed = path.join(root, 'installed-private')
    await installPreparedLibraryAtPath(installed, prepared)
    assert(!('judgmentDesk' in (await inspect(fs.readFileSync(path.join(installed, 'journal.db')))).snapshot), '预检候选安装也必须在提交前清理旧状态')
    assert(fs.readFileSync(storage.getPaths().dbFile).equals(sourceBytes), '导出与所有私有候选清理均不得改来源数据库')
  } finally {
    storage?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

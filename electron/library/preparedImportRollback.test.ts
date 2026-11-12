import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { createFullPersistedSnapshotFixture } from '../../src/storage/fixtures/fullPersistedSnapshot'
import { LibraryStorage } from './storage'
import { exportJournalZip, importJournalZipToPath, installPreparedLibraryAtPath } from './journalZip'
import { recoverPreparedImportCommitFailure, stagePreparedJournalArchive } from './preparedImportSource'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function libraryBytes(root: string): string {
  const attachments = path.join(root, 'attachments')
  return JSON.stringify({
    database: hash(fs.readFileSync(path.join(root, 'journal.db'))),
    manifest: hash(fs.readFileSync(path.join(root, 'manifest.json'))),
    attachments: fs.readdirSync(attachments).sort().map(name => [name, hash(fs.readFileSync(path.join(attachments, name)))]),
  })
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-isolated-prepared-import-failure-'))
  const source = new LibraryStorage(path.join(root, 'source'))
  const target = new LibraryStorage(path.join(root, 'target'))
  const opened: LibraryStorage[] = []
  try {
    for (const [storage, label] of [[source, 'source'], [target, 'target']] as const) {
      await storage.open()
      opened.push(storage)
      const assetId = `${label}-original-image`
      const snapshot = createFullPersistedSnapshotFixture({ trade: assetId, weeklyReview: assetId, quickNote: assetId, shared: assetId })
      snapshot.trades[0]!.ref = `${label.toUpperCase()}-EXISTING`
      snapshot.trades.push({ ...snapshot.trades[0]!, id: `${label}-existing-case`, ref: `${label.toUpperCase()}-CASE`, tradeKind: 'case',
        sourceTradeId: snapshot.trades[0]!.id, sourceNoteHtml: `<img src="journal-asset://${assetId}">`,
      })
      storage.importAsset(assetId, 'image/png', Buffer.from(`${label}-original-image-bytes`))
      storage.saveSnapshot(snapshot)
    }
    const archive = path.join(root, 'source-original.journal.zip')
    await exportJournalZip(source, archive)
    return { root, source, target, archive }
  } catch (error) {
    for (const storage of opened) storage.release()
    fs.rmSync(root, { recursive: true, force: true })
    throw error
  }
}

async function prepare(root: string, archive: string, libraryId: string) {
  const stagingRoot = fs.mkdtempSync(path.join(root, 'private-precheck-'))
  const staged = stagePreparedJournalArchive(archive, stagingRoot)
  await importJournalZipToPath(staged.stagedLibraryRoot, staged.stagedArchivePath)
  const manifestPath = path.join(staged.stagedLibraryRoot, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, libraryId }), 'utf8')
  return staged
}

export async function testPreparedNativeArchivePreflightFailurePreservesSourceAndActiveLibraryBytes(): Promise<void> {
  const { root, source, target, archive } = await fixture()
  try {
    const sourceBefore = libraryBytes(source.getLibraryPath())
    const targetBefore = libraryBytes(target.getLibraryPath())
    const archiveBefore = fs.readFileSync(archive)
    const revisionBefore = target.getSnapshotRevision()
    const damaged = path.join(root, 'damaged-copy.journal.zip')
    const zip = await JSZip.loadAsync(archiveBefore)
    zip.remove('attachments/source-original-image.png')
    fs.writeFileSync(damaged, await zip.generateAsync({ type: 'nodebuffer' }))
    const damagedBefore = fs.readFileSync(damaged)
    const stagingRoot = fs.mkdtempSync(path.join(root, 'private-invalid-precheck-'))
    const staged = stagePreparedJournalArchive(damaged, stagingRoot)
    let rejected = false
    try { await importJournalZipToPath(staged.stagedLibraryRoot, staged.stagedArchivePath) } catch { rejected = true }
    assert(rejected, '缺少原图的原生归档必须在私有预检拒绝')
    assert(libraryBytes(target.getLibraryPath()) === targetBefore && target.getSnapshotRevision() === revisionBefore, '预检失败不得改活动库DB、清单、原图或revision')
    assert(libraryBytes(source.getLibraryPath()) === sourceBefore && fs.readFileSync(archive).equals(archiveBefore), '预检失败不得改来源库及原归档')
    assert(fs.readFileSync(damaged).equals(damagedBefore), '无效用户输入副本同样保持只读')
  } finally {
    source.release(); target.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testPreparedNativeCommitCopyFailureRollsBackOriginalsAndFreshRetryDoesNotDuplicate(): Promise<void> {
  const { root, source, target, archive } = await fixture()
  const originalCopy = fs.copyFileSync
  let resumed: LibraryStorage | undefined
  try {
    const sourceBefore = libraryBytes(source.getLibraryPath())
    const targetRoot = target.getLibraryPath()
    const targetBefore = libraryBytes(targetRoot)
    const revisionBefore = target.getSnapshotRevision()
    const archiveBefore = fs.readFileSync(archive)
    const originalSnapshot = target.loadSnapshot()!
    const libraryId = target.readManifest().libraryId
    const staged = await prepare(root, archive, libraryId)
    const candidateDatabase = fs.readFileSync(path.join(staged.stagedLibraryRoot, 'journal.db'))
    const preparedAttachments = path.join(staged.stagedLibraryRoot, 'attachments')
    const activeAttachments = path.join(targetRoot, 'attachments')
    target.release()
    let hits = 0
    let reachedPartialMutation = false
    fs.copyFileSync = ((sourcePath, destinationPath, mode) => {
      if (path.dirname(String(sourcePath)) === preparedAttachments && path.dirname(String(destinationPath)) === activeAttachments) {
        fs.copyFileSync = originalCopy
        hits += 1
        reachedPartialMutation = fs.readFileSync(path.join(targetRoot, 'journal.db')).equals(candidateDatabase)
          && fs.readdirSync(activeAttachments).length === 0
        const error = new Error('isolated one-shot native commit attachment copy failure') as NodeJS.ErrnoException
        error.code = 'EIO'
        throw error
      }
      return originalCopy(sourcePath, destinationPath, mode)
    }) as typeof fs.copyFileSync
    let rejected = false
    try { await installPreparedLibraryAtPath(targetRoot, staged.stagedLibraryRoot) } catch { rejected = true }
    finally { fs.copyFileSync = originalCopy }
    assert(rejected && hits === 1 && reachedPartialMutation, '必须在部分提交后的附件复制点单次失败，不能仅证明预检拒绝')
    assert(libraryBytes(targetRoot) === targetBefore, '提交失败必须完整回滚原DB、manifest及所有原图字节')
    assert(!fs.existsSync(path.join(targetRoot, '.journal-import.json')), '成功回滚后不得遗留活动导入marker')
    let writerLifecycle = target.getLifecycleId()
    const consumedTokens = new Set(['failed-preview-token'])
    const result = await recoverPreparedImportCommitFailure({
      error: new Error('isolated commit failed'), replacementCommitted: false,
      currentStorage: () => null,
      reopen: async () => {
        resumed = new LibraryStorage(targetRoot, { allowCreate: false })
        await resumed.open()
        return resumed
      },
      adoptWriter: storage => { writerLifecycle = storage.getLifecycleId() },
      invalidatePreview: () => { consumedTokens.delete('failed-preview-token') },
    })
    const active = resumed!
    assert(!result.committed && result.code === 'TOKEN_EXPIRED' && !consumedTokens.has('failed-preview-token'), '确认回滚后应恢复原库写入并清理失效预览')
    assert(result.error === '恢复未完成，原资料库已恢复；请重新选择归档后重试。', '仅确认原库已恢复时才允许给出此明确提示')
    assert(writerLifecycle === active.getLifecycleId() && writerLifecycle !== target.getLifecycleId(), 'writer必须接管新重开生命周期，不能继续使用失效旧会话')
    assert(active.getSnapshotRevision() === revisionBefore && JSON.stringify(active.loadSnapshot()) === JSON.stringify(originalSnapshot), '重开后revision和既有交易、案例、周复盘必须保持原样')
    assert(libraryBytes(targetRoot) === targetBefore, '失败重开及writer接管本身不得改写原库')
    active.saveSnapshot({ ...active.loadSnapshot()!, tagPresets: [...originalSnapshot.tagPresets!, 'after-failed-import-edit'] }, revisionBefore)
    assert(active.getSnapshotRevision() === revisionBefore + 1 && active.loadSnapshot()!.tagPresets!.includes('after-failed-import-edit'), '原库回滚后必须可继续正常编辑，不能留失效写入会话')
    assert(libraryBytes(source.getLibraryPath()) === sourceBefore && fs.readFileSync(archive).equals(archiveBefore), '提交失败与回滚不得改来源库或用户归档')

    // Production consumes a failed commit token; a retry must perform a fresh private precheck.
    const retry = await prepare(root, archive, libraryId)
    active.release()
    await installPreparedLibraryAtPath(targetRoot, retry.stagedLibraryRoot)
    await active.open()
    const restored = active.loadSnapshot()!
    assert(restored.trades.length === source.loadSnapshot()!.trades.length && new Set(restored.trades.map(trade => trade.id)).size === restored.trades.length, '新预检重试应精确替换一次，不能重复追加交易或案例')
    assert(active.readManifest().libraryId === libraryId, '恢复与重试必须保留目标库身份')
    assert(Buffer.from(active.getAssetBytes('source-original-image')!.bytes).equals(Buffer.from('source-original-image-bytes')), '新预检重试后的来源原图必须完整')
    assert(libraryBytes(source.getLibraryPath()) === sourceBefore && fs.readFileSync(archive).equals(archiveBefore), '成功重试也不得反向写来源库与原归档')
  } finally {
    fs.copyFileSync = originalCopy
    source.release(); target.release(); resumed?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

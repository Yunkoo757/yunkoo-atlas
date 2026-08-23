import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import type { PersistedSnapshot } from '../../src/storage/types'
import { LibraryStorage, SnapshotSaveError } from './storage'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import type { Database } from 'sql.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshot(label: string): PersistedSnapshot {
  return {
    ...createEmptyPersistedSnapshot(),
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    tagPresets: [label],
  }
}

function snapshotWithAsset(label: string, assetId: string): PersistedSnapshot {
  const base = snapshot(label)
  return {
    ...base,
    trades: [{
      id: `trade-${label}`,
      ref: `TRD-${label}`,
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'open',
      conviction: 'medium',
      strategyId: 'strategy-1',
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
      openedAt: '2026-07-14',
      closedAt: null,
      note: `<img src="journal-asset://${assetId}">`,
    }],
  }
}

function snapshotWithCaseSourceAsset(label: string, assetId: string): PersistedSnapshot {
  const next = snapshotWithAsset(label, assetId)
  const source = next.trades[0]!
  return {
    ...next,
    trades: [{
      ...source,
      tradeKind: 'case',
      sourceTradeId: 'source-trade',
      note: '',
      sourceNoteHtml: `<img src="journal-asset://${assetId}">`,
    }],
  }
}

export async function testImportCommitReplacesSnapshotAndAssetsTogether(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    await storage.commitImport(snapshot('new'), [{
      id: 'fresh-asset',
      mime: 'image/png',
      buffer: Buffer.from('new-image'),
    }])

    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'new', 'the final snapshot should commit')
    assert(
      Buffer.from(storage.getAssetBytes('fresh-asset')?.bytes ?? []).equals(Buffer.from('new-image')),
      'the staged attachment should become visible with the same commit',
    )
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportCommitFailureKeepsExistingLibraryUntouched(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-rollback-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    storage.importAsset('same-id', 'image/png', Buffer.from('old-image'))

    let rejected = false
    try {
      await storage.commitImport(snapshot('new'), [{
        id: 'same-id',
        mime: 'image/png',
        buffer: Buffer.from('different-image'),
      }])
    } catch {
      rejected = true
    }

    assert(rejected, 'same-id different bytes must abort the import')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'old', 'a failed import must preserve the old snapshot')
    assert(
      Buffer.from(storage.getAssetBytes('same-id')?.bytes ?? []).equals(Buffer.from('old-image')),
      'a failed import must preserve existing attachment bytes',
    )
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testTenAssetImportFailureMidBatchLeavesNoOrphanFiles(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-mid-batch-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    storage.importAsset('asset-6', 'image/png', Buffer.from('existing-sixth-image'))

    const batch = Array.from({ length: 10 }, (_, index) => ({
      id: `asset-${index + 1}`,
      mime: 'image/png',
      buffer: Buffer.from(`new-image-${index + 1}`),
    }))
    let rejected = false
    try {
      await storage.commitImport(snapshot('new'), batch)
    } catch {
      rejected = true
    }

    assert(rejected, '第 6 张附件冲突必须中止整批导入')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'old', '中途失败不得提交新快照')
    for (let index = 1; index <= 5; index += 1) {
      assert(storage.getAssetBytes(`asset-${index}`) === null, `不得遗留第 ${index} 张孤儿附件`)
    }
    assert(
      Buffer.from(storage.getAssetBytes('asset-6')?.bytes ?? []).equals(Buffer.from('existing-sixth-image')),
      '冲突附件的原始字节必须保持不变',
    )
    for (let index = 7; index <= 10; index += 1) {
      assert(storage.getAssetBytes(`asset-${index}`) === null, `失败后不得写入第 ${index} 张附件`)
    }
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testCompensatingImportRemovesOnlyUnreferencedBatchAssets(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-compensation-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.importAsset('existing-asset', 'image/png', Buffer.from('existing-image'))
    const imported = { id: 'batch-asset', mime: 'image/png', buffer: Buffer.from('batch-image') }
    await storage.commitImport(snapshotWithAsset('imported', imported.id), [imported])
    assert(storage.getAssetBytes(imported.id) !== null, '首个原子提交必须保存被快照引用的附件')

    await storage.commitImport(snapshot('local'), [imported], { pruneUnreferenced: true })
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'local', '补偿提交必须恢复本地快照')
    assert(storage.getAssetBytes(imported.id) === null, '补偿提交必须删除本批已失去引用的附件')
    assert(storage.getAssetBytes('existing-asset') !== null, '补偿不得删除本批以外的既有附件')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testPrunedImportKeepsCaseSourceSnapshotAsset(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-case-source-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const sourceAsset = {
      id: 'case-source-only',
      mime: 'image/png',
      buffer: Buffer.from('case-source-image'),
    }
    const orphanAsset = {
      id: 'unreferenced-import',
      mime: 'image/png',
      buffer: Buffer.from('orphan-image'),
    }

    await storage.commitImport(
      snapshotWithCaseSourceAsset('case-source', sourceAsset.id),
      [sourceAsset, orphanAsset],
      { pruneUnreferenced: true },
    )

    assert(
      Buffer.from(storage.getAssetBytes(sourceAsset.id)?.bytes ?? []).equals(sourceAsset.buffer),
      'prune 导入必须保留仅由案例来源快照引用的附件',
    )
    assert(storage.getAssetBytes(orphanAsset.id) === null, 'prune 导入仍必须删除真正未引用的附件')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportKeepsAttachmentsWhenDirectoryFsyncFailsAfterDatabaseRename(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-post-rename-'))
  const storage = new LibraryStorage(root, {
    writeImportDatabase(filePath, data) {
      fs.writeFileSync(filePath, data)
      throw new Error('injected directory fsync failure after rename')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    await storage.commitImport(snapshotWithAsset('new', 'fresh-asset'), [{
      id: 'fresh-asset',
      mime: 'image/png',
      buffer: Buffer.from('durable-image'),
    }])
    storage.close()

    const reopened = new LibraryStorage(root)
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'new', 'rename 后的新数据库必须被视为已提交')
    assert(
      Buffer.from(reopened.getAssetBytes('fresh-asset')?.bytes ?? []).equals(Buffer.from('durable-image')),
      'rename 后 fsync 报错不得删除新数据库引用的附件',
    )
    reopened.close()
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportCommitRejectsPortableCaseFoldAssetIdentityCollision(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-casefold-'))
  const storage = new LibraryStorage(root)
  const bytes = Buffer.from('portable-import-commit')
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    storage.importAsset('PortableBatchAsset', 'image/png', bytes)
    const dbBefore = fs.readFileSync(storage.getPaths().dbFile)
    let failure: unknown
    try {
      await storage.commitImport(snapshot('new'), [{
        id: 'portablebatchasset',
        mime: 'image/png',
        buffer: Buffer.from(bytes),
      }])
    } catch (error) {
      failure = error
    }
    assert(failure instanceof Error, '整批导入也必须拒绝仅大小写不同的附件身份')
    assert(fs.readFileSync(storage.getPaths().dbFile).equals(dbBefore), '大小写碰撞不得改变整批 durable DB')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'old', '大小写碰撞不得发布新快照')
    assert(storage.listAssetRecords().filter((record) => record.source === 'committed').length === 1, '只能保留原始 row')
    assert(Buffer.from(storage.getAssetBytes('PortableBatchAsset')?.bytes ?? []).equals(bytes), '原始附件必须保持完整')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportCommitPreviousDatabaseBytesCleansOnlyOwnedAttachmentsAndCanRetry(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-previous-'))
  let failDatabaseWrite = false
  const storage = new LibraryStorage(root, {
    writeImportDatabase(filePath, data) {
      if (failDatabaseWrite) throw new Error('injected import DB failure before replace')
      fs.writeFileSync(filePath, data)
      return true
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    const previousDb = fs.readFileSync(storage.getPaths().dbFile)
    failDatabaseWrite = true
    let failure: unknown
    try {
      await storage.commitImport(snapshotWithAsset('new', 'owned-batch-asset'), [{
        id: 'owned-batch-asset',
        mime: 'image/png',
        buffer: Buffer.from('owned-batch-bytes'),
      }])
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError &&
        failure.outcome === 'previous-unchanged' &&
        failure.operation === 'import-asset',
      'DB 仍为 previous 字节时整批导入必须返回 typed previous-unchanged/import-asset',
    )
    assert(fs.readFileSync(storage.getPaths().dbFile).equals(previousDb), 'previous 分支不得改变 durable DB')
    assert(fs.readdirSync(storage.getPaths().attachments).length === 0, 'previous DB 不引用的本次 owned 附件必须清理')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'old', 'previous 分支必须保留 active 旧快照')

    failDatabaseWrite = false
    await storage.commitImport(snapshotWithAsset('retry', 'owned-batch-asset'), [{
      id: 'owned-batch-asset',
      mime: 'image/png',
      buffer: Buffer.from('owned-batch-bytes'),
    }])
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'retry', '同实例 retry 必须成功')
    assert(storage.getAssetBytes('owned-batch-asset') !== null, 'retry 必须提交附件')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportCommitReconciliationReadFailureLocksAndPreservesCandidateAttachments(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-read-failure-'))
  let failReconciliationRead = false
  const storage = new LibraryStorage(root, {
    writeImportDatabase(filePath, data) {
      fs.writeFileSync(filePath, data)
      failReconciliationRead = true
      throw new Error('injected import DB failure after candidate replace')
    },
    readDatabaseFile(filePath) {
      if (failReconciliationRead) {
        failReconciliationRead = false
        throw new Error('injected import DB reconciliation read failure')
      }
      return fs.readFileSync(filePath)
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    let failure: unknown
    try {
      await storage.commitImport(snapshotWithAsset('candidate', 'read-failure-asset'), [{
        id: 'read-failure-asset',
        mime: 'image/png',
        buffer: Buffer.from('read-failure-bytes'),
      }])
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError &&
        failure.outcome === 'indeterminate' &&
        failure.operation === 'import-asset',
      'DB 回读失败必须进入 typed indeterminate/import-asset',
    )
    assert(
      fs.existsSync(path.join(storage.getPaths().attachments, 'read-failure-asset.png')),
      '磁盘真相无法读取时不得删除可能已被 candidate DB 引用的附件',
    )
    let locked: unknown
    try { storage.saveSnapshot(snapshot('must-not-overwrite')) } catch (error) { locked = error }
    assert(locked === failure, '整批导入 indeterminate 必须锁住旧 lifecycle')
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'candidate', 'fresh reopen 必须读取 candidate 磁盘真相')
    assert(reopened.getAssetBytes('read-failure-asset') !== null, 'candidate 引用的附件必须完整保留')
    reopened.release()
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportCommitUnknownDatabaseBytesLocksAndPreservesAuditEvidence(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-unknown-'))
  const thirdRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-third-'))
  const third = new LibraryStorage(thirdRoot)
  await third.open()
  third.saveSnapshot(snapshot('third-disk-truth'))
  third.release()
  const thirdBytes = fs.readFileSync(path.join(thirdRoot, 'journal.db'))
  const storage = new LibraryStorage(root, {
    writeImportDatabase(filePath) {
      fs.writeFileSync(filePath, thirdBytes)
      throw new Error('injected third durable DB bytes')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    let failure: unknown
    try {
      await storage.commitImport(snapshotWithAsset('candidate', 'unknown-batch-asset'), [{
        id: 'unknown-batch-asset',
        mime: 'image/png',
        buffer: Buffer.from('unknown-batch-bytes'),
      }])
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError && failure.outcome === 'indeterminate',
      '第三组 DB 字节必须进入 indeterminate',
    )
    assert(
      fs.existsSync(path.join(storage.getPaths().attachments, 'unknown-batch-asset.png')),
      '第三态 DB 可能引用的附件必须作为审计证据保留',
    )
    let locked: unknown
    try { storage.loadSnapshot() } catch (error) { locked = error }
    assert(locked === failure, '第三态必须锁住旧 lifecycle')
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'third-disk-truth', 'fresh reopen 必须服从第三态 DB')
    assert(
      reopened.listAssetRecords().some((record) => record.id === 'unknown-batch-asset.png' && record.source === 'filesystem'),
      '第三态未引用的附件必须保留为可审计 orphan',
    )
    reopened.release()
  } finally {
    storage.release()
    third.release()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(thirdRoot, { recursive: true, force: true })
  }
}

export async function testImportCommitAdoptsCandidateEvenWhenOldActiveCloseThrows(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-close-'))
  const databases: Database[] = []
  const storage = new LibraryStorage(root, {
    createDatabase(DatabaseClass, data) {
      const database = new DatabaseClass(data)
      databases.push(database)
      return database
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    const oldActive = databases.at(-1)
    assert(oldActive, 'fixture 必须捕获旧 active DB')
    const originalClose = oldActive.close.bind(oldActive)
    let throwOnce = true
    oldActive.close = () => {
      if (throwOnce) {
        throwOnce = false
        throw new Error('injected old active close failure')
      }
      originalClose()
    }

    await storage.commitImport(snapshotWithAsset('new', 'close-failure-asset'), [{
      id: 'close-failure-asset',
      mime: 'image/png',
      buffer: Buffer.from('close-failure-bytes'),
    }])
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'new', 'durable commit 后旧 active close 失败不得撤销采用')
    assert(storage.getAssetBytes('close-failure-asset') !== null, '已提交附件不得因旧 active close 抛错而删除')
    storage.saveSnapshot(snapshot('follow-up'))
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'follow-up', '采用后的 candidate 必须支持同实例后续写入')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportCommitCandidateStartsFromAuthoritativeDiskAfterAwait(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-authoritative-'))
  const databases: Database[] = []
  const storage = new LibraryStorage(root, {
    createDatabase(DatabaseClass, data) {
      const database = new DatabaseClass(data)
      databases.push(database)
      return database
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('durable'))
    const active = databases.at(-1)
    assert(active, 'fixture 必须捕获 active DB')
    active.run(
      `INSERT INTO assets (id, mime, file_name, byte_size, created_at)
       VALUES ('memory-only', 'image/png', 'memory-only.png', 1, '2026-08-23T00:00:00.000Z')`,
    )
    assert(
      storage.listAssetRecords().some((record) => record.id === 'memory-only' && record.source === 'committed'),
      'fixture 必须制造仅 active 可见的 row',
    )

    await storage.commitImport(snapshot('imported'), [])
    assert(
      !storage.listAssetRecords().some((record) => record.id === 'memory-only' && record.source === 'committed'),
      'commitImport candidate 必须从 await 后的 journal.db 权威字节创建，不能 export active 内存态',
    )
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'imported', '权威 candidate 仍须发布导入快照')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportCommitAttachmentFailureBeforeSecondRenameRollsBackWholeBatch(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-attachment-before-'))
  let replacementAttempt = 0
  const storage = new LibraryStorage(root, {
    beforeAttachmentAtomicReplace() {
      replacementAttempt += 1
      if (replacementAttempt === 2) throw new Error('injected second attachment failure before rename')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    let failure: unknown
    try {
      await storage.commitImport(snapshot('new'), [
        { id: 'batch-first', mime: 'image/png', buffer: Buffer.from('batch-first') },
        { id: 'batch-second', mime: 'image/png', buffer: Buffer.from('batch-second') },
      ])
    } catch (error) {
      failure = error
    }
    assert(failure instanceof SnapshotSaveError && failure.outcome === 'previous-unchanged', '第二个附件 rename 前失败必须返回 previous-unchanged')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'old', '附件阶段失败不得提交 candidate DB')
    assert(fs.readdirSync(storage.getPaths().attachments).length === 0, '整批失败必须清理此前本轮 owned 附件与 temp')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportCommitUnknownAttachmentBytesLocksAndPreservesWholeBatch(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-attachment-unknown-'))
  let replacementAttempt = 0
  const storage = new LibraryStorage(root, {
    afterAttachmentAtomicReplace(targetPath) {
      replacementAttempt += 1
      if (replacementAttempt !== 2) return
      fs.writeFileSync(targetPath, Buffer.from('third-attachment-bytes'))
      throw new Error('injected second attachment unknown bytes after rename')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    let failure: unknown
    try {
      await storage.commitImport(snapshot('new'), [
        { id: 'batch-first', mime: 'image/png', buffer: Buffer.from('batch-first') },
        { id: 'batch-second', mime: 'image/png', buffer: Buffer.from('batch-second') },
      ])
    } catch (error) {
      failure = error
    }
    assert(failure instanceof SnapshotSaveError && failure.outcome === 'indeterminate', '附件第三态必须锁住整批导入')
    assert(fs.existsSync(path.join(storage.getPaths().attachments, 'batch-first.png')), 'indeterminate 必须保留此前 owned 附件')
    assert(fs.existsSync(path.join(storage.getPaths().attachments, 'batch-second.png')), 'indeterminate 必须保留第三态附件证据')
    let locked: unknown
    try { storage.loadSnapshot() } catch (error) { locked = error }
    assert(locked === failure, '附件第三态必须锁住旧 lifecycle')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
// Quality-Scenario: H0-C-ASSET-N

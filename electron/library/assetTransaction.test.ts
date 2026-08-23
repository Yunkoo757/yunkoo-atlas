import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import type { PersistedSnapshot } from '../../src/storage/types'
import { LibraryStorage, SnapshotSaveError } from './storage'
import type { Database } from 'sql.js'

type AssetFaultOptions = NonNullable<ConstructorParameters<typeof LibraryStorage>[1]> & {
  beforeAttachmentAtomicReplace?: (temporaryPath: string) => void
  afterAttachmentAtomicReplace?: (targetPath: string) => void
  readAttachmentFile?: (filePath: string) => Buffer
  removeAttachmentFile?: (filePath: string) => void
  lstatAttachmentFile?: (filePath: string) => fs.Stats
  fsyncAttachmentDirectory?: (directoryPath: string) => boolean
}

function storageWithAssetFaults(root: string, options: AssetFaultOptions): LibraryStorage {
  return new LibraryStorage(
    root,
    options as NonNullable<ConstructorParameters<typeof LibraryStorage>[1]>,
  )
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshot(label: string): PersistedSnapshot {
  const value = createEmptyPersistedSnapshot()
  value.tagPresets = [label]
  return value
}

function visibleAttachmentNames(storage: LibraryStorage): string[] {
  return fs.readdirSync(storage.getPaths().attachments)
    .sort()
}

export async function testSaveAssetFailureBeforeDatabaseReplaceKeepsActiveAndDiskUnchangedThenRetries(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-save-before-db-replace-'))
  let failBeforeReplace = false
  const storage = new LibraryStorage(root, {
    beforeAtomicReplace: () => {
      if (failBeforeReplace) throw new Error('injected asset database failure before replace')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    const previousDiskBytes = fs.readFileSync(storage.getPaths().dbFile)

    failBeforeReplace = true
    let failure: unknown
    try {
      await storage.saveAssetAsync(Buffer.from('asset-before-replace'), 'application/octet-stream')
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError &&
        failure.outcome === 'previous-unchanged' &&
        (failure as SnapshotSaveError & { operation?: string }).operation === 'save-asset',
      '附件 DB 替换前失败必须返回 typed previous-unchanged/save-asset',
    )
    assert(
      fs.readFileSync(storage.getPaths().dbFile).equals(previousDiskBytes),
      '附件 DB 替换前失败不得改变 durable journal.db',
    )
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'previous', 'active DB 必须仍是旧磁盘真相')
    assert(storage.listAssetRecords().length === 0, 'active DB 不得提前出现未提交 asset row')
    assert(visibleAttachmentNames(storage).length === 0, 'durable DB 无引用时必须删除本次新建附件')

    failBeforeReplace = false
    storage.saveSnapshot(snapshot('same-instance-follow-up'))
    const assetId = await storage.saveAssetAsync(Buffer.from('asset-before-replace'), 'application/octet-stream')
    assert(storage.getAssetBytes(assetId) !== null, '同实例 retry 必须提交附件')
    assert(visibleAttachmentNames(storage).length === 1, 'retry 后只能存在一个附件文件')
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(
      reopened.loadSnapshot()?.tagPresets?.[0] === 'same-instance-follow-up',
      '重开后必须保留 previous-unchanged 之后的同实例快照提交',
    )
    assert(reopened.getAssetBytes(assetId) !== null, '重开后必须保留 retry 提交的 asset row 与文件')
    assert(
      reopened.listAssetRecords().every((record) => record.source === 'committed' && record.state === 'healthy'),
      '重开后不得存在 orphan/temp/foreign 附件',
    )
    reopened.release()
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testSaveAssetFailureAfterDatabaseRenameAdoptsCandidateAndSupportsFollowUpSnapshot(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-save-after-db-rename-'))
  let injectAfterRename = false
  let exactCandidate: Buffer | null = null
  const storage = new LibraryStorage(root, {
    beforeAssetAtomicReplace: (temporaryPath) => {
      if (injectAfterRename) exactCandidate = fs.readFileSync(temporaryPath)
    },
    afterAssetAtomicReplace: () => {
      if (injectAfterRename) throw new Error('injected asset DB failure after rename')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('before-asset'))
    injectAfterRename = true
    const assetId = await storage.saveAssetAsync(Buffer.from('asset-after-rename'), 'application/octet-stream')
    assert(exactCandidate !== null, 'fault hook 必须捕获真实原子临时 DB 候选字节')
    assert(
      fs.readFileSync(storage.getPaths().dbFile).equals(exactCandidate),
      'rename 后报错的 durable DB 必须逐字节等于候选',
    )
    assert(storage.getAssetBytes(assetId) !== null, 'candidate 已 durable 时 active DB 必须立即采用候选')

    injectAfterRename = false
    storage.saveSnapshot(snapshot('after-asset-follow-up'))
    assert(storage.getAssetBytes(assetId) !== null, '同实例后续 snapshot 不得丢失已提交附件行')
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'after-asset-follow-up', '重开必须保留后续快照')
    assert(reopened.getAssetBytes(assetId) !== null, '重开必须保留 rename 后已提交附件')
    assert(reopened.listAssetRecords().length === 1, 'rename 后协调成功不得产生 orphan')
    reopened.release()
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testSaveAssetUnknownDatabaseBytesLocksLifecycleAndPreservesPossiblyReferencedFile(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-save-unknown-db-'))
  const thirdRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-save-third-db-'))
  const third = new LibraryStorage(thirdRoot)
  await third.open()
  third.saveSnapshot(snapshot('third-disk-truth'))
  third.release()
  const thirdBytes = fs.readFileSync(path.join(thirdRoot, 'journal.db'))
  let injectUnknown = false
  const storage = new LibraryStorage(root, {
    afterAssetAtomicReplace: (targetPath) => {
      if (!injectUnknown) return
      fs.writeFileSync(targetPath, thirdBytes)
      throw new Error('injected unknown but valid durable DB bytes')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    injectUnknown = true
    let failure: unknown
    try {
      await storage.saveAssetAsync(Buffer.from('possibly-referenced'), 'application/octet-stream')
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError &&
        failure.outcome === 'indeterminate' &&
        failure.operation === 'save-asset',
      '既非旧字节也非候选字节时必须进入 typed save-asset indeterminate',
    )
    assert(visibleAttachmentNames(storage).length === 1, 'indeterminate 不得删除可能已被 durable DB 引用的文件')
    for (const operation of [
      () => storage.loadSnapshot(),
      () => storage.saveSnapshot(snapshot('must-not-overwrite')),
      () => storage.importAsset('must-not-import', 'application/octet-stream', Buffer.from('blocked')),
    ]) {
      let locked: unknown
      try { operation() } catch (error) { locked = error }
      assert(
        locked instanceof SnapshotSaveError && locked.outcome === 'indeterminate',
        '共享 recovery lock 必须阻止旧实例的 snapshot 与 asset 后续写入',
      )
    }
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'third-disk-truth', 'fresh reopen 必须服从第三态磁盘真相')
    const records = reopened.listAssetRecords()
    assert(
      records.length === 1 && records[0]?.source === 'filesystem',
      '第三态 DB 未引用文件时只能保留可审计 filesystem orphan，不能伪造 committed row',
    )
    reopened.release()
  } finally {
    storage.release()
    third.release()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(thirdRoot, { recursive: true, force: true })
  }
}

export async function testSaveAssetReconciliationReadFailureLocksOldInstanceAndFreshReopenLoadsCandidate(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-save-read-failure-'))
  let failReconciliationRead = false
  const storage = new LibraryStorage(root, {
    readDatabaseFile: (filePath) => {
      if (failReconciliationRead) {
        failReconciliationRead = false
        throw new Error('injected reconciliation read failure')
      }
      return fs.readFileSync(filePath)
    },
    afterAssetAtomicReplace: () => {
      failReconciliationRead = true
      throw new Error('injected post-rename barrier failure')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    let failure: unknown
    try {
      await storage.saveAssetAsync(Buffer.from('candidate-on-disk'), 'application/octet-stream')
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError && failure.outcome === 'indeterminate',
      '协调回读失败必须进入 typed indeterminate',
    )
    const retainedFile = visibleAttachmentNames(storage)[0]
    assert(typeof retainedFile === 'string', '回读失败不得删除可能由 candidate DB 引用的附件')
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    const committedIds = reopened.listAssetRecords().filter((record) => record.source === 'committed')
    assert(committedIds.length === 1 && committedIds[0]?.state === 'healthy', 'fresh reopen 必须读取实际 candidate row')
    assert(visibleAttachmentNames(reopened).join(',') === retainedFile, 'fresh reopen 必须保留 candidate 引用的同一文件')
    reopened.release()
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportAssetFailureBeforeDatabaseReplaceKeepsActiveAndDiskUnchangedThenRetries(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-import-before-db-replace-'))
  let failBeforeReplace = false
  const storage = new LibraryStorage(root, {
    beforeAtomicReplace: () => {
      if (failBeforeReplace) throw new Error('injected import database failure before replace')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    const previousDiskBytes = fs.readFileSync(storage.getPaths().dbFile)
    const assetId = 'import-before-replace'
    const assetBytes = Buffer.from('import-before-replace-bytes')

    failBeforeReplace = true
    let failure: unknown
    try { storage.importAsset(assetId, 'application/octet-stream', assetBytes) } catch (error) { failure = error }
    assert(
      failure instanceof SnapshotSaveError &&
        failure.outcome === 'previous-unchanged' &&
        failure.operation === 'import-asset',
      '导入附件 DB 替换前失败必须返回 typed previous-unchanged/import-asset',
    )
    assert(fs.readFileSync(storage.getPaths().dbFile).equals(previousDiskBytes), '失败不得改变 durable DB 字节')
    assert(storage.getAssetBytes(assetId) === null, 'active DB 不得提前出现导入 row')
    assert(visibleAttachmentNames(storage).length === 0, 'durable DB 无引用时必须清理本次导入文件')

    failBeforeReplace = false
    storage.saveSnapshot(snapshot('same-instance-follow-up'))
    storage.importAsset(assetId, 'application/octet-stream', assetBytes)
    assert(Buffer.from(storage.getAssetBytes(assetId)?.bytes ?? []).equals(assetBytes), '同实例 retry 必须提交附件')
    assert(visibleAttachmentNames(storage).length === 1, 'retry 后只能存在一个附件文件')
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'same-instance-follow-up', '重开必须保留后续快照')
    assert(Buffer.from(reopened.getAssetBytes(assetId)?.bytes ?? []).equals(assetBytes), '重开必须保留 retry 结果')
    assert(reopened.listAssetRecords().length === 1, '重开不得出现 orphan row/file')
    reopened.release()
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportAssetFailureAfterDatabaseRenameAdoptsCandidateAndSupportsFollowUpSnapshot(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-import-after-db-rename-'))
  let injectAfterRename = false
  let exactCandidate: Buffer | null = null
  const storage = new LibraryStorage(root, {
    beforeAssetAtomicReplace: (temporaryPath) => {
      if (injectAfterRename) exactCandidate = fs.readFileSync(temporaryPath)
    },
    afterAssetAtomicReplace: () => {
      if (injectAfterRename) throw new Error('injected import DB failure after rename')
    },
  })
  const assetId = 'import-after-rename'
  const assetBytes = Buffer.from('import-after-rename-bytes')
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('before-import'))
    injectAfterRename = true
    storage.importAsset(assetId, 'application/octet-stream', assetBytes)
    assert(exactCandidate !== null, '导入 fault hook 必须捕获真实 DB 候选')
    assert(fs.readFileSync(storage.getPaths().dbFile).equals(exactCandidate), 'durable DB 必须等于 rename 后候选')
    assert(Buffer.from(storage.getAssetBytes(assetId)?.bytes ?? []).equals(assetBytes), 'active 必须采用已提交候选')

    injectAfterRename = false
    storage.saveSnapshot(snapshot('after-import-follow-up'))
    storage.release()
    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'after-import-follow-up', '重开必须保留后续快照')
    assert(Buffer.from(reopened.getAssetBytes(assetId)?.bytes ?? []).equals(assetBytes), '重开必须保留导入附件')
    assert(reopened.listAssetRecords().length === 1, 'rename 后协调不得产生 orphan')
    reopened.release()
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportAssetUnknownDatabaseBytesLocksLifecycleAndPreservesFile(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-import-unknown-db-'))
  const thirdRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-import-third-db-'))
  const third = new LibraryStorage(thirdRoot)
  await third.open()
  third.saveSnapshot(snapshot('import-third-disk-truth'))
  third.release()
  const thirdBytes = fs.readFileSync(path.join(thirdRoot, 'journal.db'))
  let injectUnknown = false
  const storage = new LibraryStorage(root, {
    afterAssetAtomicReplace: (targetPath) => {
      if (!injectUnknown) return
      fs.writeFileSync(targetPath, thirdBytes)
      throw new Error('injected import unknown durable DB')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    injectUnknown = true
    let failure: unknown
    try {
      storage.importAsset('import-unknown', 'application/octet-stream', Buffer.from('import-unknown-bytes'))
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError &&
        failure.outcome === 'indeterminate' &&
        failure.operation === 'import-asset',
      '导入遇到第三态 DB 必须进入共享 typed recovery lock',
    )
    assert(visibleAttachmentNames(storage).length === 1, 'indeterminate 导入不得删除可能被引用的文件')
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'import-third-disk-truth', 'fresh reopen 必须服从第三态 DB')
    assert(
      reopened.listAssetRecords().every((record) => record.source === 'filesystem'),
      '第三态未提交 import row 时文件只能作为可审计 orphan 保留',
    )
    reopened.release()
  } finally {
    storage.release()
    third.release()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(thirdRoot, { recursive: true, force: true })
  }
}

export async function testImportAssetReconciliationReadFailureLocksOldInstanceAndFreshReopenLoadsCandidate(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-import-read-failure-'))
  let failReconciliationRead = false
  const storage = new LibraryStorage(root, {
    readDatabaseFile: (filePath) => {
      if (failReconciliationRead) {
        failReconciliationRead = false
        throw new Error('injected import reconciliation read failure')
      }
      return fs.readFileSync(filePath)
    },
    afterAssetAtomicReplace: () => {
      failReconciliationRead = true
      throw new Error('injected import post-rename failure')
    },
  })
  const assetId = 'import-read-failure'
  const assetBytes = Buffer.from('import-candidate-on-disk')
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    let failure: unknown
    try { storage.importAsset(assetId, 'application/octet-stream', assetBytes) } catch (error) { failure = error }
    assert(
      failure instanceof SnapshotSaveError && failure.outcome === 'indeterminate',
      '导入协调回读失败必须进入 indeterminate',
    )
    assert(visibleAttachmentNames(storage).length === 1, '协调回读失败必须保留文件')
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(Buffer.from(reopened.getAssetBytes(assetId)?.bytes ?? []).equals(assetBytes), 'fresh reopen 必须读取 candidate row/file')
    assert(reopened.listAssetRecords()[0]?.state === 'healthy', 'fresh reopen 后不得有损坏或 orphan')
    reopened.release()
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportAssetDedupeAndConflictsNeverRewriteDurableTruth(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-import-dedupe-'))
  let rejectRewrites = false
  let databaseRewriteAttempts = 0
  let attachmentRewriteAttempts = 0
  const storage = storageWithAssetFaults(root, {
    beforeAssetAtomicReplace: () => {
      if (!rejectRewrites) return
      databaseRewriteAttempts += 1
      throw new Error('dedupe unexpectedly rewrote journal.db')
    },
    beforeAttachmentAtomicReplace: () => {
      if (!rejectRewrites) return
      attachmentRewriteAttempts += 1
      throw new Error('dedupe unexpectedly rewrote attachment')
    },
  })
  const assetId = 'import-dedupe'
  const bytes = Buffer.from('stable-import-bytes')
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('stable'))
    storage.importAsset(assetId, 'application/octet-stream', bytes)
    const dbBeforeDedupe = fs.readFileSync(storage.getPaths().dbFile)
    const filePath = path.join(storage.getPaths().attachments, `${assetId}.bin`)
    const fileMtimeBefore = fs.statSync(filePath).mtimeMs

    rejectRewrites = true
    storage.importAsset(assetId, 'application/octet-stream', Buffer.from(bytes))
    assert(fs.readFileSync(storage.getPaths().dbFile).equals(dbBeforeDedupe), '同 ID/metadata/bytes 重试不得重写 DB')
    assert(fs.statSync(filePath).mtimeMs === fileMtimeBefore, '幂等重试不得重写附件文件')
    assert(databaseRewriteAttempts === 0, '幂等重试不得触发 DB atomic replace hook')
    assert(attachmentRewriteAttempts === 0, '幂等重试不得触发附件 atomic replace hook')

    for (const attempt of [
      () => storage.importAsset(assetId, 'application/octet-stream', Buffer.from('DIFFERENT-BYTES')),
      () => storage.importAsset(assetId, 'image/png', Buffer.from(bytes)),
    ]) {
      let rejected = false
      try { attempt() } catch { rejected = true }
      assert(rejected, '同 ID 内容或 MIME 冲突必须在任何 durable 改写前拒绝')
      assert(fs.readFileSync(storage.getPaths().dbFile).equals(dbBeforeDedupe), '冲突拒绝不得改变 DB')
      assert(fs.readFileSync(filePath).equals(bytes), '冲突拒绝不得覆盖旧附件')
    }
    assert(storage.listAssetRecords().length === 1, 'dedupe/conflict 后必须恰好一 row/file')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportAssetRejectsPortableCaseFoldIdentityCollision(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-portable-casefold-'))
  const storage = new LibraryStorage(root)
  const original = Buffer.from('portable-casefold-bytes')
  try {
    await storage.open()
    storage.importAsset('PortableAsset', 'application/octet-stream', original)
    const dbBeforeCollision = fs.readFileSync(storage.getPaths().dbFile)

    let failure: unknown
    try {
      storage.importAsset('portableasset', 'application/octet-stream', Buffer.from(original))
    } catch (error) {
      failure = error
    }
    assert(failure instanceof Error, '仅大小写不同的附件 ID 必须在 Windows/macOS 可移植语义下拒绝')
    assert(fs.readFileSync(storage.getPaths().dbFile).equals(dbBeforeCollision), '大小写碰撞不得重写 durable DB')
    const records = storage.listAssetRecords().filter((record) => record.source === 'committed')
    assert(records.length === 1 && records[0]?.id === 'PortableAsset', '大小写碰撞后必须只保留原始 row')
    assert(
      Buffer.from(storage.getAssetBytes('PortableAsset')?.bytes ?? []).equals(original),
      '大小写碰撞不得覆盖或删除原始附件',
    )
    assert(visibleAttachmentNames(storage).length === 1, '大小写碰撞不得生成第二个物理附件')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportAssetRejectsAmbiguousAndNonRegularPortableMatches(): Promise<void> {
  const duplicateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-duplicate-match-'))
  const duplicate = new LibraryStorage(duplicateRoot)
  try {
    await duplicate.open()
    duplicate.importAsset('duplicate-match', 'application/octet-stream', Buffer.from('stable'))
    fs.writeFileSync(
      path.join(duplicate.getPaths().attachments, 'duplicate-match.zzz'),
      Buffer.from('foreign'),
    )
    let duplicateFailure: unknown
    try {
      duplicate.importAsset('duplicate-match', 'application/octet-stream', Buffer.from('stable'))
    } catch (error) {
      duplicateFailure = error
    }
    assert(duplicateFailure instanceof Error, '同 ID 多扩展物理文件必须拒绝，不能任取首个文件 dedupe')
  } finally {
    duplicate.release()
    fs.rmSync(duplicateRoot, { recursive: true, force: true })
  }

  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-nonregular-match-'))
  let inspectAsSymlink = false
  const nonRegular = storageWithAssetFaults(linkRoot, {
    lstatAttachmentFile: (filePath) => {
      const stat = fs.lstatSync(filePath)
      if (!inspectAsSymlink) return stat
      return {
        ...stat,
        isFile: () => true,
        isSymbolicLink: () => true,
      } as fs.Stats
    },
  })
  try {
    await nonRegular.open()
    nonRegular.importAsset('nonregular-match', 'application/octet-stream', Buffer.from('stable'))
    inspectAsSymlink = true
    let linkFailure: unknown
    try {
      nonRegular.importAsset('nonregular-match', 'application/octet-stream', Buffer.from('stable'))
    } catch (error) {
      linkFailure = error
    }
    assert(linkFailure instanceof Error, '幂等导入只能接受唯一普通非 symlink 附件')
  } finally {
    nonRegular.release()
    fs.rmSync(linkRoot, { recursive: true, force: true })
  }
}

export async function testAttachmentFailureBeforeRenameLeavesDatabaseUnchangedAndStorageUsable(): Promise<void> {
  for (const operation of ['save', 'import'] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `atlas-asset-${operation}-file-before-`))
    let failAttachmentReplace = false
    const storage = storageWithAssetFaults(root, {
      beforeAttachmentAtomicReplace: () => {
        if (failAttachmentReplace) throw new Error(`injected ${operation} attachment failure before rename`)
      },
    })
    try {
      await storage.open()
      storage.saveSnapshot(snapshot('before-attachment-fault'))
      const dbBefore = fs.readFileSync(storage.getPaths().dbFile)
      failAttachmentReplace = true
      let failure: unknown
      try {
        if (operation === 'save') {
          await storage.saveAssetAsync(Buffer.from('before-rename'), 'application/octet-stream')
        } else {
          storage.importAsset('before-rename-import', 'application/octet-stream', Buffer.from('before-rename'))
        }
      } catch (error) {
        failure = error
      }
      assert(
        failure instanceof SnapshotSaveError &&
          failure.outcome === 'previous-unchanged' &&
          failure.operation === (operation === 'save' ? 'save-asset' : 'import-asset'),
        '附件 rename 前失败必须精确分类为 previous-unchanged',
      )
      assert(fs.readFileSync(storage.getPaths().dbFile).equals(dbBefore), '附件 rename 前失败不得修改 DB')
      assert(visibleAttachmentNames(storage).length === 0, '附件 rename 前失败不得遗留目标或临时文件')
      failAttachmentReplace = false
      storage.saveSnapshot(snapshot('same-instance-still-usable'))
      assert(storage.loadSnapshot()?.tagPresets?.[0] === 'same-instance-still-usable', 'unchanged 后旧实例必须继续可写')
    } finally {
      storage.release()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

export async function testAttachmentFailureAfterRenameUsesExactBytesOrLocksOnUnknownTruth(): Promise<void> {
  for (const operation of ['save', 'import'] as const) {
    const committedRoot = fs.mkdtempSync(path.join(os.tmpdir(), `atlas-asset-${operation}-file-committed-`))
    let afterHookCalls = 0
    const committed = storageWithAssetFaults(committedRoot, {
      afterAttachmentAtomicReplace: () => {
        afterHookCalls += 1
        throw new Error(`injected ${operation} attachment failure after exact rename`)
      },
    })
    try {
      await committed.open()
      if (operation === 'save') {
        const id = await committed.saveAssetAsync(Buffer.from('exact-after-rename'), 'application/octet-stream')
        assert(committed.getAssetBytes(id) !== null, 'exact target bytes 后 save 必须继续提交 DB')
      } else {
        committed.importAsset('exact-after-rename-import', 'application/octet-stream', Buffer.from('exact-after-rename'))
        assert(committed.getAssetBytes('exact-after-rename-import') !== null, 'exact target bytes 后 import 必须继续提交 DB')
      }
      assert(afterHookCalls === 1, '测试必须真实命中附件 rename 后 fault seam')
    } finally {
      committed.release()
      fs.rmSync(committedRoot, { recursive: true, force: true })
    }

    for (const reconciliation of ['different-bytes', 'read-failure'] as const) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `atlas-asset-${operation}-file-${reconciliation}-`))
      let failRead = false
      const storage = storageWithAssetFaults(root, {
        afterAttachmentAtomicReplace: (targetPath) => {
          if (reconciliation === 'different-bytes') fs.writeFileSync(targetPath, Buffer.from('foreign-durable-bytes'))
          else failRead = true
          throw new Error(`injected ${operation} attachment ${reconciliation}`)
        },
        readAttachmentFile: (filePath) => {
          if (failRead) throw new Error('injected attachment reconciliation read failure')
          return fs.readFileSync(filePath)
        },
      })
      try {
        await storage.open()
        const dbBefore = fs.readFileSync(storage.getPaths().dbFile)
        let failure: unknown
        try {
          if (operation === 'save') {
            await storage.saveAssetAsync(Buffer.from('candidate-file-bytes'), 'application/octet-stream')
          } else {
            storage.importAsset('unknown-file-import', 'application/octet-stream', Buffer.from('candidate-file-bytes'))
          }
        } catch (error) {
          failure = error
        }
        assert(
          failure instanceof SnapshotSaveError &&
            failure.outcome === 'indeterminate' &&
            failure.operation === (operation === 'save' ? 'save-asset' : 'import-asset'),
          '附件目标存在但非精确候选或不可回读时必须进入 indeterminate',
        )
        assert(fs.readFileSync(storage.getPaths().dbFile).equals(dbBefore), '附件未知态发生在 DB 提交前')
        assert(visibleAttachmentNames(storage).length === 1, '附件未知态必须保留磁盘证据')
        let locked: unknown
        try { storage.loadSnapshot() } catch (error) { locked = error }
        assert(locked === failure, '附件未知态必须锁住同一 LibraryStorage 生命周期')
      } finally {
        storage.release()
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  }
}

export async function testAttachmentCleanupFailurePromotesDatabaseUnchangedToIndeterminate(): Promise<void> {
  for (const operation of ['save-remove', 'import-fsync'] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `atlas-asset-${operation}-cleanup-`))
    let failDatabaseReplace = false
    const storage = storageWithAssetFaults(root, {
      beforeAssetAtomicReplace: () => {
        if (failDatabaseReplace) throw new Error('injected database failure before rename')
      },
      removeAttachmentFile: (filePath) => {
        if (operation === 'save-remove') throw new Error('injected attachment remove failure')
        fs.rmSync(filePath)
      },
      fsyncAttachmentDirectory: (directoryPath) => {
        if (operation === 'import-fsync') throw new Error('injected attachment directory fsync failure')
        return fsyncDirectorySyncForTest(directoryPath)
      },
    })
    try {
      await storage.open()
      storage.saveSnapshot(snapshot('cleanup-previous'))
      failDatabaseReplace = true
      let failure: unknown
      try {
        if (operation === 'save-remove') {
          await storage.saveAssetAsync(Buffer.from('cleanup-save'), 'application/octet-stream')
        } else {
          storage.importAsset('cleanup-import', 'application/octet-stream', Buffer.from('cleanup-import'))
        }
      } catch (error) {
        failure = error
      }
      assert(
        failure instanceof SnapshotSaveError && failure.outcome === 'indeterminate',
        'DB previous 字节下附件 cleanup 失败不得谎报可安全重试，必须升级 indeterminate',
      )
      let locked: unknown
      try { storage.saveSnapshot(snapshot('must-be-locked')) } catch (error) { locked = error }
      assert(locked === failure, 'cleanup 失败必须进入共享 recovery lock')
      if (operation === 'save-remove') {
        assert(visibleAttachmentNames(storage).length === 1, 'remove 失败必须保留可审计 orphan')
      }
    } finally {
      storage.release()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

function fsyncDirectorySyncForTest(directoryPath: string): boolean {
  if (process.platform === 'win32') return false
  const descriptor = fs.openSync(directoryPath, 'r')
  try {
    fs.fsyncSync(descriptor)
    return true
  } finally {
    fs.closeSync(descriptor)
  }
}

export async function testImportAssetMatchingOrphanIsPreservedOnUnchangedAndAdoptedOnRetry(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-import-orphan-retry-'))
  let failBeforeReplace = false
  const storage = new LibraryStorage(root, {
    beforeAssetAtomicReplace: () => {
      if (failBeforeReplace) throw new Error('injected orphan adoption failure')
    },
  })
  const assetId = 'matching-orphan'
  const bytes = Buffer.from('matching-orphan-bytes')
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    const filePath = path.join(storage.getPaths().attachments, `${assetId}.bin`)
    fs.writeFileSync(filePath, bytes)
    failBeforeReplace = true
    let failure: unknown
    try { storage.importAsset(assetId, 'application/octet-stream', bytes) } catch (error) { failure = error }
    assert(
      failure instanceof SnapshotSaveError && failure.outcome === 'previous-unchanged',
      '复用 orphan 时 DB 替换前失败仍须 typed previous-unchanged',
    )
    assert(fs.existsSync(filePath), 'previous-unchanged 只能清理本次 owned 文件，不得删除预存 orphan')
    assert(storage.getAssetBytes(assetId) === null, '未提交 DB 不得在 active 中伪造 row')

    failBeforeReplace = false
    storage.importAsset(assetId, 'application/octet-stream', bytes)
    assert(Buffer.from(storage.getAssetBytes(assetId)?.bytes ?? []).equals(bytes), 'retry 必须采用预存同字节文件')
    assert(storage.listAssetRecords().length === 1, 'retry 必须收敛为一条 healthy committed record')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testAssetCandidateUsesAuthoritativeDiskBytesInsteadOfDivergedActiveDatabase(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-authoritative-disk-'))
  const databases: Database[] = []
  const storage = new LibraryStorage(root, {
    createDatabase: (DatabaseClass, data) => {
      const database = new DatabaseClass(data)
      databases.push(database)
      return database
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('durable-disk-truth'))
    const activeBeforeImport = databases.at(-1)
    assert(activeBeforeImport, 'fixture 必须捕获当前 active sql.js 实例')
    activeBeforeImport.run(
      `UPDATE meta SET value = ? WHERE key = 'snapshot'`,
      [JSON.stringify(snapshot('active-memory-only'))],
    )
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'active-memory-only', 'fixture 必须制造 active/disk 分叉')

    storage.importAsset('authoritative-disk-asset', 'application/octet-stream', Buffer.from('disk-based'))
    assert(
      storage.loadSnapshot()?.tagPresets?.[0] === 'durable-disk-truth',
      'asset candidate 必须从 journal.db 权威字节建库，不能 export 已分叉 active DB',
    )
    storage.release()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'durable-disk-truth', '重开必须与 adopted active 一致')
    assert(reopened.getAssetBytes('authoritative-disk-asset') !== null, '磁盘候选必须组合既有快照与新 asset row')
    reopened.release()
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testSaveAssetRejectsMimePathSeparatorsBeforeTouchingAttachments(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-mime-path-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    const sentinel = path.join(storage.getPaths().attachments, 'victim.png')
    fs.writeFileSync(sentinel, Buffer.from('outside-attempt-sentinel'))
    let failure: unknown
    try {
      await storage.saveAssetAsync(
        Buffer.from('must-not-overwrite'),
        'application/x\\..\\victim.png',
      )
    } catch (error) {
      failure = error
    }
    assert(failure instanceof Error, 'MIME subtype 中的平台分隔符必须在附件写入前被拒绝')
    assert(fs.readFileSync(sentinel, 'utf8') === 'outside-attempt-sentinel', '恶意 MIME 不得覆盖既有附件')
    assert(
      fs.readdirSync(storage.getPaths().attachments).join(',') === 'victim.png',
      '恶意 MIME 不得创建别名、临时文件或额外附件',
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testAllAttachmentEntryPointsRejectDirectoryJunctionBeforeOutsideAccess(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-junction-root-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-junction-outside-'))
  const storage = new LibraryStorage(root)
  const assetId = 'junction-existing'
  try {
    await storage.open()
    storage.importAsset(assetId, 'application/octet-stream', Buffer.from('inside-bytes'))
    const paths = storage.getPaths()
    const original = path.join(paths.attachments, `${assetId}.bin`)
    fs.copyFileSync(original, path.join(outside, `${assetId}.bin`))
    const realAttachments = path.join(root, 'attachments-real')
    fs.renameSync(paths.attachments, realAttachments)
    fs.symlinkSync(outside, paths.attachments, process.platform === 'win32' ? 'junction' : 'dir')

    for (const [label, operation] of [
      ['read', () => storage.getAssetBytes(assetId)],
      ['backup-name-list', () => storage.listCommittedAttachmentFileNames()],
      ['archive-file-list', () => storage.listCommittedAttachmentFiles()],
      ['import', () => storage.importAsset('junction-import', 'application/octet-stream', Buffer.from('blocked-import'))],
      ['save', () => storage.saveAssetAsync(Buffer.from('blocked-save'), 'application/octet-stream')],
    ] as const) {
      let failure: unknown
      try { await operation() } catch (error) { failure = error }
      assert(failure instanceof Error, `${label} 必须拒绝 symlink/junction attachments 目录`)
    }
    assert(!fs.existsSync(path.join(outside, 'junction-import.bin')), 'import 不得穿透 junction 写入库外')
    assert(fs.readdirSync(outside).length === 1, 'save 不得穿透 junction 创建随机库外附件')

    fs.rmSync(paths.attachments)
    fs.renameSync(realAttachments, paths.attachments)
  } finally {
    const attachments = storage.getPaths().attachments
    try {
      if (fs.existsSync(attachments) && fs.lstatSync(attachments).isSymbolicLink()) fs.rmSync(attachments)
      const realAttachments = path.join(root, 'attachments-real')
      if (!fs.existsSync(attachments) && fs.existsSync(realAttachments)) fs.renameSync(realAttachments, attachments)
    } catch { /* test cleanup continues below */ }
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
}

export async function testUnobservableAttachmentTargetIsIndeterminateNotMissing(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-unobservable-'))
  let injectObservationFailure = false
  const storage = new LibraryStorage(root, {
    afterAttachmentAtomicReplace(targetPath) {
      if (!injectObservationFailure) return
      fs.rmSync(targetPath)
      throw new Error('injected attachment post-replace failure')
    },
    lstatAttachmentFile(filePath) {
      if (injectObservationFailure) {
        const error = new Error(`injected inaccessible attachment target: ${filePath}`) as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      }
      return fs.lstatSync(filePath)
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    injectObservationFailure = true
    let failure: unknown
    try {
      await storage.saveAssetAsync(Buffer.from('unobservable'), 'application/octet-stream')
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError && failure.outcome === 'indeterminate',
      '目标无法严格观测时不得用 existsSync 谎报 previous-unchanged',
    )
    let locked: unknown
    try { storage.loadSnapshot() } catch (error) { locked = error }
    assert(locked === failure, '无法观测附件目标必须锁住 lifecycle')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testCandidateCloseFailureCannotMaskIndeterminateDatabaseTruth(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-candidate-close-'))
  let createdDatabases = 0
  let candidateCloseCalls = 0
  let failReconciliationRead = false
  const storage = new LibraryStorage(root, {
    createDatabase(DatabaseClass, data) {
      const database = new DatabaseClass(data)
      createdDatabases += 1
      if (createdDatabases === 3) {
        database.close = () => {
          candidateCloseCalls += 1
          throw new Error('injected detached candidate close failure')
        }
      }
      return database
    },
    afterAssetAtomicReplace() {
      failReconciliationRead = true
      throw new Error('injected DB post-replace failure')
    },
    readDatabaseFile(filePath) {
      if (failReconciliationRead) {
        failReconciliationRead = false
        throw new Error('injected reconciliation read failure')
      }
      return fs.readFileSync(filePath)
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    let failure: unknown
    try {
      storage.importAsset('candidate-close-asset', 'application/octet-stream', Buffer.from('candidate-close'))
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError && failure.outcome === 'indeterminate',
      'detached candidate close 抛错不得覆盖 DB 回读失败的 indeterminate 归类',
    )
    assert(candidateCloseCalls === 1, 'candidate ownership 必须先转移，close 最多 best-effort 一次')
    let locked: unknown
    try { storage.saveSnapshot(snapshot('must-be-locked')) } catch (error) { locked = error }
    assert(locked === failure, 'candidate close 失败也不得绕过共享 recovery lock')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testCleanupNeverDeletesAttachmentWhoseBytesChangedAfterMaterialization(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-cleanup-byte-proof-'))
  let injectBeforeDatabaseReplace = false
  let replacedPath = ''
  const replacementBytes = Buffer.from('concurrent-replacement-must-survive')
  const storage = new LibraryStorage(root, {
    beforeAssetAtomicReplace() {
      if (!injectBeforeDatabaseReplace) return
      const targetName = fs.readdirSync(path.join(root, 'attachments'))
        .find((name) => !name.startsWith('.'))
      assert(targetName, 'fixture 必须找到已 materialize 的附件目标')
      replacedPath = path.join(root, 'attachments', targetName)
      fs.writeFileSync(replacedPath, replacementBytes)
      throw new Error('injected DB previous with concurrently replaced attachment')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    injectBeforeDatabaseReplace = true
    let failure: unknown
    try {
      await storage.saveAssetAsync(Buffer.from('attempt-owned-bytes'), 'application/octet-stream')
    } catch (error) {
      failure = error
    }
    assert(
      failure instanceof SnapshotSaveError && failure.outcome === 'indeterminate',
      'DB previous 时若附件已被替换，cleanup 必须升级 indeterminate 而非删除非 owned 字节',
    )
    assert(replacedPath !== '' && fs.readFileSync(replacedPath).equals(replacementBytes), '不同字节必须原样保留')
    let locked: unknown
    try { storage.saveSnapshot(snapshot('must-be-locked')) } catch (error) { locked = error }
    assert(locked === failure, 'cleanup ownership 无法证明时必须锁住 lifecycle')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testCommitImportPruneRejectsAttachmentJunctionWithoutDeletingOutsideFile(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-prune-junction-root-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-prune-junction-outside-'))
  const storage = new LibraryStorage(root)
  const assetId = 'junction-prune'
  const assetBytes = Buffer.from('junction-prune-live')
  try {
    await storage.open()
    storage.importAsset(assetId, 'application/octet-stream', assetBytes)
    storage.saveSnapshot(snapshot('before-prune'))
    const paths = storage.getPaths()
    const realAttachments = path.join(root, 'attachments-real')
    fs.copyFileSync(
      path.join(paths.attachments, `${assetId}.bin`),
      path.join(outside, `${assetId}.bin`),
    )
    fs.renameSync(paths.attachments, realAttachments)
    fs.symlinkSync(outside, paths.attachments, process.platform === 'win32' ? 'junction' : 'dir')

    let failure: unknown
    try {
      await storage.commitImport(
        snapshot('after-prune'),
        [{ id: assetId, mime: 'application/octet-stream', buffer: assetBytes }],
        { pruneUnreferenced: true },
      )
    } catch (error) {
      failure = error
    }
    assert(failure instanceof Error, 'commitImport prune 必须拒绝 junction attachments 根目录')
    assert(
      fs.readFileSync(path.join(outside, `${assetId}.bin`)).equals(assetBytes),
      'prune 不得穿透 junction 删除库外同名附件',
    )
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'before-prune', 'junction 拒绝不得发布 candidate DB')

    fs.rmSync(paths.attachments)
    fs.renameSync(realAttachments, paths.attachments)
  } finally {
    const attachments = storage.getPaths().attachments
    try {
      if (fs.existsSync(attachments) && fs.lstatSync(attachments).isSymbolicLink()) fs.rmSync(attachments)
      const realAttachments = path.join(root, 'attachments-real')
      if (!fs.existsSync(attachments) && fs.existsSync(realAttachments)) fs.renameSync(realAttachments, attachments)
    } catch { /* test cleanup continues below */ }
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
}

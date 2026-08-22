import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import type { PersistedSnapshot } from '../../src/storage/types'
import { LibraryStorage, SnapshotSaveError } from './storage'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function snapshot(label: string): PersistedSnapshot {
  const value = createEmptyPersistedSnapshot()
  value.tagPresets = [label]
  return value
}

export async function testSnapshotFailureBeforeReplaceKeepsActiveAndDiskPreviousThenRetries(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-snapshot-before-replace-'))
  let failBeforeReplace = false
  const storage = new LibraryStorage(root, {
    beforeSnapshotAtomicReplace: () => {
      if (failBeforeReplace) throw new Error('injected before replace')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    const previousBytes = fs.readFileSync(storage.getPaths().dbFile)

    failBeforeReplace = true
    let failure: unknown
    try { storage.saveSnapshot(snapshot('candidate')) } catch (error) { failure = error }
    assert(
      failure instanceof SnapshotSaveError && failure.outcome === 'previous-unchanged',
      `替换前失败必须按磁盘真相分类为 previous-unchanged（实际：${String(failure)} / ${(failure as { outcome?: string })?.outcome ?? 'none'}）`,
    )
    assert(
      fs.readFileSync(storage.getPaths().dbFile).equals(previousBytes),
      '替换前失败不得改变磁盘数据库字节',
    )
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'previous', '同一实例必须继续读取旧快照')

    failBeforeReplace = false
    storage.saveSnapshot(snapshot('candidate'))
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'candidate', '同一实例重试必须提交候选快照')
    storage.close()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'candidate', '进程重开必须读取重试后的候选快照')
    reopened.close()
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testSnapshotFailureAfterRenameAdoptsCandidateAndReopensAuthoritatively(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-snapshot-after-rename-'))
  let failAfterReplace = false
  const capturedCandidateBytes: Buffer[] = []
  const storage = new LibraryStorage(root, {
    beforeSnapshotAtomicReplace: (temporaryPath) => {
      if (failAfterReplace) capturedCandidateBytes.push(fs.readFileSync(temporaryPath))
    },
    afterSnapshotAtomicReplace: () => {
      if (failAfterReplace) throw new Error('injected directory fsync failure after rename')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    const previousBytes = fs.readFileSync(storage.getPaths().dbFile)

    failAfterReplace = true
    const result = storage.saveSnapshot(snapshot('candidate'))
    const exactCandidateBytes = capturedCandidateBytes[0]
    assert(
      result.kind === 'committed-after-write-error',
      'rename 已写入候选字节时必须返回可协调的 committed-after-write-error',
    )
    assert(
      exactCandidateBytes !== null && fs.readFileSync(storage.getPaths().dbFile).equals(exactCandidateBytes),
      'rename 后磁盘字节必须与原子临时文件中的候选逐字节相同',
    )
    assert(!exactCandidateBytes.equals(previousBytes), '候选数据库必须与旧数据库字节不同')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'candidate', '同一实例必须采用磁盘上的候选数据库')
    storage.close()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'candidate', '进程重开必须读取 rename 后已提交候选')
    reopened.close()
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testSnapshotIndeterminateDiskStateLocksSameInstanceAgainstOverwrite(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-snapshot-indeterminate-'))
  let corruptAfterReplace = false
  const storage = new LibraryStorage(root, {
    afterSnapshotAtomicReplace: (targetPath) => {
      if (!corruptAfterReplace) return
      fs.appendFileSync(targetPath, Buffer.from([0xff]))
      throw new Error('injected unknown disk outcome')
    },
  })
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))
    corruptAfterReplace = true
    let failure: unknown
    try { storage.saveSnapshot(snapshot('candidate')) } catch (error) { failure = error }
    assert(
      failure instanceof SnapshotSaveError && failure.outcome === 'indeterminate',
      '既非候选也非旧字节时必须返回类型化 indeterminate',
    )

    for (const operation of [
      () => storage.loadSnapshot(),
      () => storage.saveSnapshot(snapshot('must-not-overwrite')),
    ]) {
      let locked: unknown
      try { operation() } catch (error) { locked = error }
      assert(
        locked instanceof SnapshotSaveError && locked.outcome === 'indeterminate',
        '不确定态的同一实例必须保持不可读写，禁止后续覆盖磁盘证据',
      )
    }
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImageSaveCannotRaceSnapshotDatabaseSwapOrLeaveAnOrphan(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-snapshot-asset-race-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('previous'))

    // processImageBuffer is async, so this deterministically yields after the asset save has
    // entered but before its database mutation. The snapshot save used to close that captured DB.
    const pendingAsset = storage.saveAssetAsync(Buffer.from('concurrent-image'), 'image/png')
    storage.saveSnapshot(snapshot('next'))
    const assetId = await pendingAsset

    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'next', '并发附件保存不得覆盖已提交的新快照')
    assert(
      Buffer.from(storage.getAssetBytes(assetId)?.bytes ?? []).equals(Buffer.from('concurrent-image')),
      '并发附件保存必须同时提交数据库行与附件文件',
    )
    assert(
      fs.readdirSync(storage.getPaths().attachments).filter((name) => !name.startsWith('.')).length === 1,
      '并发附件保存不得留下无数据库行的孤儿文件',
    )
    storage.close()

    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'next', '重开后必须保留并发期间提交的新快照')
    assert(reopened.getAssetBytes(assetId) !== null, '重开后必须保留并发期间提交的附件数据库行')
    reopened.close()
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testAssetPurgeCannotRaceSnapshotDatabaseSwapOrLeaveTrash(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-snapshot-asset-purge-race-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.importAsset('orphan-asset', 'application/octet-stream', Buffer.from('orphan'))
    storage.saveSnapshot(snapshot('previous'))
    const preview = storage.previewAssetPurge()

    // commitAssetPurge must yield only before it observes the preview/CAS/database state.
    // A synchronous snapshot swap in that gap must therefore fail safe as a stale preview,
    // never resume against the now-closed sql.js database captured by the old implementation.
    const pendingPurge = storage.commitAssetPurge(preview)
    storage.saveSnapshot(snapshot('concurrent-snapshot'))

    let result: Awaited<ReturnType<LibraryStorage['commitAssetPurge']>> | null = null
    let failure: unknown = null
    try { result = await pendingPurge } catch (error) { failure = error }

    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'concurrent-snapshot', '并发快照必须保持为当前快照')
    if (result) {
      assert(result.deletedIds.join(',') === 'orphan-asset', '成功清理必须完整删除既定孤儿附件')
      assert(storage.getAssetBytes('orphan-asset') === null, '成功清理不得留下附件数据库行')
    } else {
      assert(
        failure instanceof Error && failure.message.includes('资料库在预览后已变化'),
        `并发清理只能因 stale revision 安全拒绝，不得出现旧数据库错误（实际：${String(failure)}）`,
      )
      assert(storage.getAssetBytes('orphan-asset') !== null, 'stale revision 拒绝必须零删除附件')
    }
    assert(!fs.existsSync(path.join(root, '.trash')), '并发清理完成或拒绝后均不得遗留 .trash')

    storage.close()
    const reopened = new LibraryStorage(root, { allowCreate: false })
    await reopened.open()
    assert(reopened.loadSnapshot()?.tagPresets?.[0] === 'concurrent-snapshot', '重开后必须保留并发快照')
    if (result) {
      assert(reopened.getAssetBytes('orphan-asset') === null, '重开后必须保持成功清理结果')
    } else {
      assert(reopened.getAssetBytes('orphan-asset') !== null, '重开后必须保持 stale revision 零删除结果')
    }
    reopened.close()
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

// Quality-Scenario: LS-SNAPSHOT-TRANSACTION

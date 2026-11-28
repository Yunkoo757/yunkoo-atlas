import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  matchesStagedJournalArchive,
  recoverPreparedImportCommitFailure,
  stagePreparedJournalArchive,
} from './preparedImportSource'

export async function testFailedPreparedCommitLocksWritesIfReopenOrWriterAdoptionCannotBeConfirmed(): Promise<void> {
  for (const failure of ['reopen', 'adopt'] as const) {
    const active = { label: 'new-lifecycle' }
    let invalidations = 0
    const reported: unknown[] = []
    const technicalError = new Error('installation failed at /isolated/private/journal.db')
    const result = await recoverPreparedImportCommitFailure({
      error: technicalError, replacementCommitted: false,
      currentStorage: () => null,
      reopen: async () => { if (failure === 'reopen') throw new Error('cannot reopen'); return active },
      resumeRolledBackWriter: () => { if (failure === 'adopt') throw new Error('cannot adopt writer') },
      invalidatePreview: () => { invalidations += 1 },
      reportFailure: error => { reported.push(error) },
    })
    assert.equal(result.ok, false)
    assert.equal(result.committed, true, '恢复结果未确认时必须阻止renderer将旧快照写回')
    assert.equal(result.code, 'TOKEN_EXPIRED', '失败候选必须关闭旧预览，不能重复确认')
    assert.equal(invalidations, 1, '恢复失败仍须消费并清理旧token')
    assert.equal(result.error, '恢复结果尚未确认，自动保存已暂停；请重新打开资料库核对后再操作。')
    assert.doesNotMatch(result.error, /installation|cannot|journal\.db|\/isolated/)
    assert.equal(reported[0], technicalError, '技术原因应保留给安全诊断回调，而不是拼入用户文案')
    assert.equal(reported.length, 2, '安装与重开/接管异常都应交给安全诊断')
  }
}

export async function testCommittedPreparedFailureStaysLockedEvenAfterSuccessfulReopen(): Promise<void> {
  const current = { label: 'reopened-lifecycle' }
  let adopted: typeof current | undefined
  let invalidated = false
  const result = await recoverPreparedImportCommitFailure({
    error: new Error('post-commit read failed'), replacementCommitted: true,
    currentStorage: () => current,
    reopen: async () => { throw new Error('existing reopened lifecycle should be reused') },
    resumeRolledBackWriter: storage => { adopted = storage },
    invalidatePreview: () => { invalidated = true },
  })
  assert.equal(adopted, undefined)
  assert.equal(invalidated, true)
  assert.equal(result.committed, true, '磁盘已经替换时不能让renderer按原库自动保存')
  assert.equal(result.code, 'TOKEN_EXPIRED')
  assert.equal(result.error, '恢复结果尚未确认，自动保存已暂停；请重新打开资料库核对后再操作。')
}

export function testPreparedRestoreUsesOnePrivateArchiveCopyForPreviewAndCommit(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-prepared-archive-copy-'))
  const sourcePath = path.join(root, 'selected.journal.zip')
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-prepared-archive-staging-'))
  try {
    fs.writeFileSync(sourcePath, 'verified-archive-bytes')
    const staged = stagePreparedJournalArchive(sourcePath, stagingRoot)
    fs.writeFileSync(sourcePath, 'changed-after-preview')

    assert.equal(fs.readFileSync(staged.stagedArchivePath, 'utf8'), 'verified-archive-bytes')
    assert.equal(matchesStagedJournalArchive(staged.stagedArchivePath, staged.stagedArchiveSha256), true)
    fs.writeFileSync(staged.stagedArchivePath, 'tampered-private-copy')
    assert.equal(matchesStagedJournalArchive(staged.stagedArchivePath, staged.stagedArchiveSha256), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(stagingRoot, { recursive: true, force: true })
  }
}

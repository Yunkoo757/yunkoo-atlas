import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  capturePreparedImportSource,
  matchesStagedJournalArchive,
  matchesPreparedImportSource,
  stagePreparedJournalArchive,
} from './preparedImportSource'

class FakeStorageLifecycle {
  constructor(
    private readonly libraryPath: string,
    private readonly lifecycleId: string,
  ) {}

  getLibraryPath(): string {
    return this.libraryPath
  }

  getLifecycleId(): string {
    return this.lifecycleId
  }
}

export function testPreparedRestoreAllowsNormalWritesFromTheSameStorageLifecycle(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-prepared-restore-source-'))
  const databasePath = path.join(root, 'journal.db')
  const storage = new FakeStorageLifecycle(root, 'active-lifecycle')
  try {
    fs.writeFileSync(databasePath, 'before', 'utf8')
    const preparedSource = capturePreparedImportSource(storage)

    // “替换”前的最终持久化会正常重写 journal.db；这不能让恢复预览失效。
    fs.writeFileSync(databasePath, 'after-final-persist', 'utf8')

    assert.equal(matchesPreparedImportSource(preparedSource, storage), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testPreparedRestoreRejectsAReopenedOrSwitchedStorageLifecycle(): void {
  const root = path.resolve(os.tmpdir(), 'atlas-prepared-restore-source-lifecycle')
  const original = new FakeStorageLifecycle(root, 'original-lifecycle')
  const preparedSource = capturePreparedImportSource(original)

  assert.equal(
    matchesPreparedImportSource(
      preparedSource,
      new FakeStorageLifecycle(root, 'reopened-lifecycle'),
    ),
    false,
  )
  assert.equal(
    matchesPreparedImportSource(
      preparedSource,
      new FakeStorageLifecycle(path.join(root, 'other'), 'original-lifecycle'),
    ),
    false,
  )
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

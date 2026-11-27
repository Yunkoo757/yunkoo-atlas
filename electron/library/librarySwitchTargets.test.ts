import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { LibraryStorage } from './storage'
import { LibrarySwitchTargets } from './librarySwitchTargets'

async function withLibraries(run: (root: string, source: LibraryStorage, targets: LibrarySwitchTargets) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-isolated-switch-targets-'))
  const source = new LibraryStorage(path.join(root, 'source'))
  try {
    await source.open()
    await run(root, source, new LibrarySwitchTargets((dir, options) => new LibraryStorage(dir, options)))
  } finally {
    source.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testPreparedTargetReopensLatestRevisionOfSelectedLibrary() {
  await withLibraries(async (root, source, targets) => {
    const dir = path.join(root, 'selected')
    const selection = { path: dir, mode: 'open' } as const
    const original = new LibraryStorage(dir)
    try {
      await original.open()
      const snapshot = createEmptyPersistedSnapshot()
      original.saveSnapshot(snapshot)
      const prepared = await targets.prepare(selection, source)
      original.saveSnapshot({ ...snapshot, tagPresets: ['after-selection'] })
      const fresh = await targets.open(prepared, source)
      try {
        assert.equal(fresh.revision, original.getSnapshotRevision())
        assert.deepEqual(fresh.snapshot?.tagPresets, ['after-selection'])
        assert.equal(fresh.libraryId, original.readManifest().libraryId)
      } finally {
        fresh.candidate.release()
      }
      original.release()
      fs.renameSync(dir, path.join(root, 'moved'))
      const replacement = new LibraryStorage(dir)
      try {
        await replacement.open()
        replacement.saveSnapshot({ ...snapshot, tagPresets: ['different-library'] })
        const db = replacement.getPaths().dbFile
        const before = fs.readFileSync(db)
        await assert.rejects(targets.open(prepared, source), /交易库已变化/)
        assert.deepEqual(fs.readFileSync(db), before)
        const retry = await targets.open(await targets.prepare(selection, source), source)
        try {
          assert.equal(retry.libraryId, replacement.readManifest().libraryId)
          assert.deepEqual(retry.snapshot?.tagPresets, ['different-library'])
        } finally {
          retry.candidate.release()
        }
      } finally {
        replacement.release()
      }
    } finally {
      original.release()
    }
  })
}

export async function testPreparedCreateRechecksEmptyTargetAndPreservesNewFiles() {
  await withLibraries(async (root, source, targets) => {
    const dir = path.join(root, 'new')
    const prepared = await targets.prepare({ mode: 'create', path: dir }, source)
    assert.equal(fs.existsSync(dir), false)
    fs.mkdirSync(dir)
    await targets.prepare({ mode: 'create', path: dir }, source)
    assert.deepEqual(fs.readdirSync(dir), [])
    const file = path.join(dir, 'arrived.txt')
    fs.writeFileSync(file, 'keep', 'utf8')
    await assert.rejects(targets.open(prepared, source), /空目录/)
    assert.deepEqual(fs.readdirSync(dir), ['arrived.txt'])
    assert.equal(fs.readFileSync(file, 'utf8'), 'keep')
    fs.unlinkSync(file)
    const created = await targets.open(prepared, source)
    try {
      assert.equal(created.snapshot, null)
      assert.equal(created.revision, 0)
      assert.notEqual(created.libraryId, source.readManifest().libraryId)
    } finally {
      created.candidate.release()
    }
  })
}

export async function testDirectAndPreparedSelectionRejectActivePathAndCopiedIdentity() {
  await withLibraries(async (root, source, targets) => {
    const clone = path.join(root, 'copy')
    fs.cpSync(source.getLibraryPath(), clone, { recursive: true })
    for (const dir of [source.getLibraryPath(), clone]) {
      const selection = { mode: 'open', path: dir } as const
      await assert.rejects(targets.open(selection, source), /已经是当前交易库/)
      await assert.rejects(targets.prepare(selection, source), /已经是当前交易库/)
    }
  })
}

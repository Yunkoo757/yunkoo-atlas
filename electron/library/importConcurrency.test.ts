import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LibraryStorage } from './storage'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'

function snapshot(label: string) {
  return { ...createEmptyPersistedSnapshot(), tagPresets: [label] }
}

async function isolated(run: (storage: LibraryStorage) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-isolated-import-cas-'))
  const storage = new LibraryStorage(root)
  try { await storage.open(); await run(storage) } finally { storage.close(); fs.rmSync(root, { recursive: true, force: true }) }
}

export async function testImportRechecksRevisionAfterSqlInitializationYields() {
  await isolated(async storage => {
    storage.saveSnapshot(snapshot('initial'), 0)
    const importing = storage.commitImport(snapshot('stale'), [], { expectedSnapshotRevision: 1 })
    storage.saveSnapshot(snapshot('winner'), 1)
    await assert.rejects(importing, /revision|版本|冲突/i)
    assert.equal(storage.loadSnapshot()!.tagPresets![0], 'winner')
    assert.equal(storage.getSnapshotRevision(), 2)
  })
}

export async function testConcurrentImportsWithTheSameRevisionHaveExactlyOneWinner() {
  await isolated(async storage => {
    const results = await Promise.allSettled([
      storage.commitImport(snapshot('A'), [{ id: 'isolated-a', mime: 'application/octet-stream', buffer: Buffer.from('A') }], { expectedSnapshotRevision: 0 }),
      storage.commitImport(snapshot('B'), [{ id: 'isolated-b', mime: 'application/octet-stream', buffer: Buffer.from('B') }], { expectedSnapshotRevision: 0 }),
    ])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(storage.getSnapshotRevision(), 1)
    assert.equal(storage.loadSnapshot()!.tagPresets![0], 'A')
    assert.equal(storage.getAssetBytes('isolated-b'), null, '失败批次不得留下 DB 行或物理附件')
    assert.equal(fs.readdirSync(storage.getPaths().attachments).length, 1)
  })
}

export async function testConcurrentUnconditionalImportsStillAdvanceTheAuthoritativeRevision() {
  await isolated(async storage => {
    await Promise.all([storage.commitImport(snapshot('A'), []), storage.commitImport(snapshot('B'), [])])
    assert.equal(storage.getSnapshotRevision(), 2, '每个成功批次必须基于实际提交时的 revision 递增')
  })
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { LibraryStorage, StaleLibraryStorageError } from './storage'
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

export async function testSnapshotWritersCompareTheRevisionOfTheDurableCandidate() {
  await isolated(async writer => {
    writer.saveSnapshot(snapshot('initial'), 0)
    const stale = new LibraryStorage(writer.getLibraryPath(), { allowCreate: false })
    try {
      await stale.open()
      writer.saveSnapshot(snapshot('winner'), 1)
      const previous = fs.readFileSync(writer.getPaths().dbFile)
      assert.throws(() => stale.saveSnapshot(snapshot('old snapshot'), 1), /版本/)
      await assert.rejects(stale.commitImport(snapshot('old import'), [], { expectedSnapshotRevision: 1 }), /版本/)
      assert.deepEqual(fs.readFileSync(writer.getPaths().dbFile), previous)
      await assert.rejects(stale.commitImport(snapshot('old unconditional import'), []), StaleLibraryStorageError)
      assert.deepEqual(fs.readFileSync(writer.getPaths().dbFile), previous)
      await writer.commitImport(snapshot('new import'), [])
      assert.equal(writer.getSnapshotRevision(), 3)
    } finally { stale.release() }
  })
}

export async function testInitializationPreservesSnapshotEvenWhenTheWriterKnowsItsRevision() {
  await isolated(async storage => {
    storage.saveSnapshot(snapshot('winner'), 0)
    const file = storage.getPaths().dbFile
    const before = fs.readFileSync(file)
    const result = await storage.commitImport(snapshot('stale initialization'), [{
      id: 'should-not-appear', mime: 'image/png', buffer: Buffer.from('candidate'),
    }], { requireEmptySnapshot: true, expectedSnapshotRevision: 1 }).then(() => 'committed', () => 'rejected')
    assert.equal(result, 'rejected', '首次初始化在已知最新版本时仍须检查快照不存在')
    assert.deepEqual(fs.readFileSync(file), before)
    assert.equal(storage.getAssetBytes('should-not-appear'), null)
    assert.deepEqual(fs.readdirSync(storage.getPaths().attachments), [])
  })
}

export async function testImportOnlyInitializesAnAbsentRevisionAndNeverOverwritesAnInvalidOne() {
  const SQL = await initSqlJs({ locateFile: () => path.resolve('node_modules/sql.js/dist/sql-wasm.wasm') })
  await isolated(async storage => {
    storage.saveSnapshot(snapshot('original'), 0)
    const file = storage.getPaths().dbFile
    const original = fs.readFileSync(file)
    for (const value of ['', '  ', 'invalid', '9007199254740992', '9007199254740990.9', new Uint8Array([49])]) {
      const candidate = new SQL.Database(original)
      try {
        candidate.run("UPDATE meta SET value = ? WHERE key='snapshotRevision'", [value])
        fs.writeFileSync(file, candidate.export())
      } finally { candidate.close() }
      const previous = fs.readFileSync(file)
      await assert.rejects(storage.commitImport(snapshot('unreadable revision'), [{
        id: 'not-committed', mime: 'image/png', buffer: Buffer.from('new image'),
      }]), /修订|revision/i)
      assert.deepEqual(fs.readFileSync(file), previous)
      assert.deepEqual(fs.readdirSync(storage.getPaths().attachments), [])
    }

    const padded = new SQL.Database(original)
    try {
      padded.run("UPDATE meta SET value = ? WHERE key='snapshotRevision'", [' 09007199254740990 '])
      fs.writeFileSync(file, padded.export())
    } finally { padded.close() }
    storage.saveSnapshot(snapshot('last valid revision'), Number.MAX_SAFE_INTEGER - 1)
    assert.equal(storage.getSnapshotRevision(), Number.MAX_SAFE_INTEGER)
    const lastValid = fs.readFileSync(file)
    assert.throws(() => storage.saveSnapshot(snapshot('overflow'), Number.MAX_SAFE_INTEGER), /上限/)
    assert.deepEqual(fs.readFileSync(file), lastValid)

    const legacy = new SQL.Database(original)
    try {
      legacy.run("DELETE FROM meta WHERE key='snapshotRevision'")
      fs.writeFileSync(file, legacy.export())
    } finally { legacy.close() }
    await storage.commitImport(snapshot('legacy write'), [], { expectedSnapshotRevision: 0 })
    assert.equal(storage.getSnapshotRevision(), 1)
    assert.deepEqual(storage.loadSnapshot()?.tagPresets, ['legacy write'])
  })
}

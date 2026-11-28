import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { LibraryAutoBackup } from './autoBackup'
import { listBackups } from './backup'
import { LibraryOperationGate } from './sessionGate'
import { LibraryStorage } from './storage'

export async function testAutomaticBackupKeepsOriginalDeadlineUntilCandidateIsAccepted(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-isolated-backup-timer-'))
  const current = new LibraryStorage(path.join(root, 'active'))
  const candidate = new LibraryStorage(path.join(root, 'candidate'))
  const count = (storage: LibraryStorage) => listBackups(storage).length
  const gate = new LibraryOperationGate()
  const interval = 15 * 60 * 1000
  let failures = 0
  const backup = new LibraryAutoBackup(gate, () => { failures++ })
  try {
    for (const lib of [current, candidate]) {
      await lib.open()
      lib.saveSnapshot(createEmptyPersistedSnapshot())
    }
    mock.timers.enable({ apis: ['setInterval'] })
    backup.start(current)
    mock.timers.tick(interval - 1)
    const accept = backup.prepare(candidate)
    backup.start(current)
    mock.timers.tick(1)
    await setImmediate()
    assert.deepEqual([count(current), count(candidate)], [1, 0])

    accept()
    await gate.runExclusive(async () => {
      mock.timers.tick(interval)
      await setImmediate()
    })
    assert.deepEqual([count(current), count(candidate), failures], [1, 0, 0])

    mock.timers.tick(interval)
    await setImmediate()
    assert.deepEqual([count(current), count(candidate)], [1, 1])
    fs.unlinkSync(path.join(candidate.getLibraryPath(), 'journal.db'))
    mock.timers.tick(interval)
    await setImmediate()
    assert.equal(failures, 1)
    assert.equal(backup.stop(), true)
    mock.timers.tick(interval)
    await setImmediate()
    assert.equal(failures, 1)
    assert.equal(backup.stop(), false)
  } finally {
    backup.stop()
    mock.timers.reset()
    current.release()
    candidate.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

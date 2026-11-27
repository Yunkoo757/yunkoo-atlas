import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { createBackupAtPath } from './backup'
import { restoreLibraryBackup } from './backupRestore'
import { LibraryOperationGate } from './sessionGate'
import { LibraryStorage, SnapshotSaveError } from './storage'

async function isolatedSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-isolated-backup-session-'))
  const gate = new LibraryOperationGate()
  const first = new LibraryStorage(root)
  let active: LibraryStorage | null = first
  const events: string[] = []
  const session: Parameters<typeof restoreLibraryBackup>[1] = {
    withExclusiveWriter: work => gate.runExclusive(() => {
      assert.ok(active)
      return work(active)
    }),
    close(current) {
      assert.ok(gate.isExclusive())
      assert.equal(current, active)
      current.close()
      active = null
      events.push('close')
    },
    async reopenForWriter() {
      assert.ok(gate.isExclusive(), '重开与接管写入路由都必须在原请求持锁期间完成')
      assert.equal(active, null)
      const next = new LibraryStorage(root, { allowCreate: false })
      await next.open()
      active = next
      events.push('reopen')
      return next
    },
    notifyRecoveryRequired(state) { events.push(state.code) },
  }
  function dispose() {
    active?.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
  try {
    await first.open()
    return { root, first, gate, session, events, dispose, active: () => active }
  } catch (error) {
    dispose()
    throw error
  }
}

export async function testBusyBackupRestoreCannotAdoptAnotherRequestsWriterOrClaimItsCutover(): Promise<void> {
  const f = await isolatedSession()
  try {
    const saved = createEmptyPersistedSnapshot()
    saved.tagPresets = ['backup']
    f.first.saveSnapshot(saved)
    const selected = createBackupAtPath(f.first, f.root)
    assert.ok(selected)
    f.first.saveSnapshot({ ...saved, tagPresets: ['before restore'] })
    const reopen = f.session.reopenForWriter
    f.session.reopenForWriter = async () => {
      const other = await restoreLibraryBackup(selected, f.session)
      assert.equal(other.ok, false)
      assert.equal(other.committed, false)
      return reopen()
    }
    const result = await restoreLibraryBackup(selected, f.session)
    assert.ok(result.ok)
    assert.deepEqual(result.snapshot.tagPresets, ['backup'])
    assert.deepEqual(f.events, ['close', 'reopen'])
    const active = f.active()
    assert.ok(active)
    active.saveSnapshot({ ...result.snapshot, tagPresets: ['follow-up'] }, active.getSnapshotRevision())
    assert.deepEqual(active.loadSnapshot()?.tagPresets, ['follow-up'])
  } finally { f.dispose() }
}

export async function testBackupRestoreRequiresValidSourceAndVerifiedSafetyCopyBeforeClosing(): Promise<void> {
  const f = await isolatedSession()
  try {
    const saved = createEmptyPersistedSnapshot()
    f.first.saveSnapshot(saved)
    const before = fs.readFileSync(path.join(f.root, 'journal.db'))
    const missing = await restoreLibraryBackup('missing.db', f.session)
    assert.deepEqual(missing, { ok: false, committed: false, error: '恢复点文件不存在' })
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'backups')).filter(name => name.endsWith('.db')), [])
    const selected = createBackupAtPath(f.first, f.root)
    assert.ok(selected)
    f.first.exportSnapshotDatabaseBytes = () => Buffer.from('unreadable safety copy')
    const invalid = await restoreLibraryBackup(selected, f.session)
    assert.equal(invalid.ok, false)
    assert.equal(invalid.committed, false)
    assert.deepEqual(f.events, [])
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'journal.db')), before)
  } finally { f.dispose() }
}

export async function testBackupRestoreReopensUnderTheSameGateAfterCutoverFailure(): Promise<void> {
  const f = await isolatedSession()
  try {
    f.first.saveSnapshot(createEmptyPersistedSnapshot())
    const selected = createBackupAtPath(f.first, f.root)
    assert.ok(selected)
    const reopen = f.session.reopenForWriter
    let attempts = 0
    f.session.reopenForWriter = async () => {
      assert.equal(f.gate.isExclusive(), true)
      if (++attempts === 1) throw new Error('readback interrupted')
      return reopen()
    }
    const result = await restoreLibraryBackup(selected, f.session)
    assert.deepEqual(result, { ok: false, committed: true, error: 'readback interrupted' })
    assert.equal(attempts, 2)
    assert.deepEqual(f.events, ['close', 'reopen'])
    assert.ok(f.active()?.loadSnapshot())
    assert.equal(f.gate.isExclusive(), false)
  } finally { f.dispose() }
}

export async function testRestoringAnEmptyBackupBroadcastsIndeterminateSnapshotWrite(): Promise<void> {
  const f = await isolatedSession()
  try {
    const empty = createBackupAtPath(f.first, f.root, Date.now(), { emptyLibrary: true })
    assert.ok(empty)
    f.first.saveSnapshot(createEmptyPersistedSnapshot())
    const reopen = f.session.reopenForWriter
    f.session.reopenForWriter = async () => {
      const next = await reopen()
      next.saveSnapshot = () => { throw new SnapshotSaveError('indeterminate', new Error('disk state unknown')) }
      return next
    }
    const result = await restoreLibraryBackup(empty, f.session)
    assert.equal(result.ok, false)
    assert.equal(result.committed, true)
    assert.deepEqual(f.events, ['close', 'reopen', 'storage-write-indeterminate'])
  } finally { f.dispose() }
}

export async function testVerifiedEmptyBackupReturnsTheSnapshotPersistedForTheNextLaunch(): Promise<void> {
  const f = await isolatedSession()
  let nextLaunch: LibraryStorage | undefined
  try {
    const selected = createBackupAtPath(f.first, f.root, Date.now(), { emptyLibrary: true })
    assert.ok(selected)
    f.first.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['discarded by restore'] })
    const restored = await restoreLibraryBackup(selected, f.session)
    assert.ok(restored.ok)
    assert.deepEqual(restored.snapshot.trades, [])
    assert.deepEqual(restored.snapshot.tagPresets ?? [], [])
    assert.deepEqual(f.active()?.loadSnapshot(), restored.snapshot)
    f.active()?.release()
    nextLaunch = new LibraryStorage(f.root, { allowCreate: false })
    await nextLaunch.open()
    assert.deepEqual(nextLaunch.loadSnapshot(), restored.snapshot)
  } finally {
    nextLaunch?.release()
    f.dispose()
  }
}

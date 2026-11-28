import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { DEFAULT_SYMBOL_CATALOG } from '../../src/lib/symbolIconCodec'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { createVerifiedBackup, deleteBackupAtPath, listBackups, restoreBackupAtPath, rotateBackups, verifyBackupAtPath, writeLibraryBackup } from './backup'
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
    async reopen() {
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
    const selected = writeLibraryBackup(f.first)
    assert.ok(selected)
    f.first.saveSnapshot({ ...saved, tagPresets: ['before restore'] })
    const reopen = f.session.reopen
    f.session.reopen = async () => {
      const other = await restoreLibraryBackup(selected, f.session)
      assert.equal(other.ok, false)
      assert.equal(other.committed, false)
      return reopen()
    }
    const result = await restoreLibraryBackup(selected, f.session)
    assert.ok(result.ok)
    assert.equal(result.revision, f.active()?.getSnapshotRevision())
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
    const selected = writeLibraryBackup(f.first)
    assert.ok(selected)
    f.first.exportSnapshotDatabaseBytes = () => Buffer.from('unreadable safety copy')
    const invalid = await restoreLibraryBackup(selected, f.session)
    assert.equal(invalid.ok, false)
    assert.equal(invalid.committed, false)
    assert.deepEqual(f.events, [])
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'journal.db')), before)
  } finally { f.dispose() }
}

export async function testFinishedBackupRestoreSurvivesLockedVerificationAndRecoveryDirectories() {
  for (const prefix of ['.backup-verify-', '.backup-restore-recovery-']) {
    const f = await isolatedSession()
    const remove = fs.rmSync
    let locked: string | undefined
    try {
      const snapshot = { ...createEmptyPersistedSnapshot(), tagPresets: ['恢复结果'] }
      f.first.saveSnapshot(snapshot)
      const selected = writeLibraryBackup(f.first)
      assert.ok(selected)
      f.first.saveSnapshot({ ...snapshot, tagPresets: ['被替换的版本'] })
      fs.rmSync = (file, options) => {
        if (typeof file === 'string' && path.dirname(file) === f.root &&
            path.basename(file).startsWith(prefix) && f.events.includes('close')) {
          locked = file
          throw Object.assign(new Error('临时目录仍被占用'), { code: 'EBUSY' })
        }
        remove(file, options)
      }
      const result = await restoreLibraryBackup(selected, f.session)
      assert.ok(locked && fs.existsSync(locked))
      assert.deepEqual(f.active()?.loadSnapshot()?.tagPresets, ['恢复结果'])
      assert.equal(fs.existsSync(path.join(f.root, '.backup-restore.json')), false)
      assert.ok(result.ok, '已落盘并能重开的恢复结果应返回给 renderer')
      assert.deepEqual(result.snapshot.tagPresets, ['恢复结果'])
      assert.equal(result.revision, f.active()?.getSnapshotRevision())
    } finally { fs.rmSync = remove; f.dispose() }
  }
}

export async function testFailedBackupRollbackCopyDiscardsOnlyItsOwnUnpublishedWorkspace() {
  const f = await isolatedSession()
  const copy = fs.copyFileSync
  try {
    f.first.saveSnapshot(createEmptyPersistedSnapshot())
    const selected = writeLibraryBackup(f.first)
    assert.ok(selected)
    const untouched = path.join(f.root, '.backup-restore-recovery-earlier')
    fs.mkdirSync(untouched)
    const dbFile = f.first.getPaths().dbFile
    const before = fs.readFileSync(dbFile)
    let failed: string | undefined
    fs.copyFileSync = (from, to, mode) => {
      if (typeof to === 'string' && from === dbFile && path.basename(path.dirname(to)).startsWith('.backup-restore-recovery-')) {
        failed = path.dirname(to)
        throw new Error('安全副本复制中断')
      }
      copy(from, to, mode)
    }
    const result = await restoreLibraryBackup(selected, f.session)
    assert.equal(result.ok, false)
    assert.ok(failed && !fs.existsSync(failed), '发布事务标记前失败时，仅移除本请求刚创建的目录')
    assert.ok(fs.existsSync(untouched))
    assert.deepEqual(fs.readFileSync(dbFile), before)
    assert.equal(fs.existsSync(path.join(f.root, '.backup-restore.json')), false)
  } finally { fs.copyFileSync = copy; f.dispose() }
}

export async function testBackupRestoreReopensUnderTheSameGateAfterCutoverFailure(): Promise<void> {
  const f = await isolatedSession()
  try {
    f.first.saveSnapshot(createEmptyPersistedSnapshot())
    const selected = writeLibraryBackup(f.first)
    assert.ok(selected)
    const reopen = f.session.reopen
    let attempts = 0
    f.session.reopen = async () => {
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
    const empty = writeLibraryBackup(f.first, Date.now(), { emptyLibrary: true })
    assert.ok(empty)
    f.first.saveSnapshot(createEmptyPersistedSnapshot())
    const reopen = f.session.reopen
    f.session.reopen = async () => {
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
    const selected = writeLibraryBackup(f.first, Date.now(), { emptyLibrary: true })
    assert.ok(selected)
    f.first.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['discarded by restore'] })
    const restored = await restoreLibraryBackup(selected, f.session)
    assert.ok(restored.ok)
    assert.deepEqual(restored.snapshot.trades, [])
    assert.deepEqual(restored.snapshot.symbolCatalog, [...DEFAULT_SYMBOL_CATALOG])
    assert.deepEqual(restored.snapshot.tagPresets ?? [], [])
    assert.deepEqual(f.active()?.loadSnapshot(), restored.snapshot)
    f.active()?.release()
    nextLaunch = new LibraryStorage(f.root, { allowCreate: false })
    await nextLaunch.open()
    assert.deepEqual(nextLaunch.loadSnapshotEnvelope(), { snapshot: restored.snapshot, revision: restored.revision })
  } finally {
    nextLaunch?.release()
    f.dispose()
  }
}

export async function testBackupWithMatchingChecksumAndUnreadableRevisionCannotReplaceActiveLibrary() {
  const f = await isolatedSession()
  try {
    f.first.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['backup'] })
    const SQL = await initSqlJs({ locateFile: () => path.resolve('node_modules/sql.js/dist/sql-wasm.wasm') })
    const source = new SQL.Database(f.first.exportSnapshotDatabaseBytes())
    let selected: string | null
    try {
      source.run("UPDATE meta SET value='invalid' WHERE key='snapshotRevision'")
      selected = writeLibraryBackup({
        getLibraryPath: () => f.root,
        getCounts: () => f.first.getCounts(),
        listCommittedAttachmentFileNames: () => f.first.listCommittedAttachmentFileNames(),
        exportSnapshotDatabaseBytes: () => Buffer.from(source.export()),
      }, Date.UTC(2024, 0, 1))
    } finally { source.close() }
    assert.ok(selected)
    f.first.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['active'] })
    const file = f.first.getPaths().dbFile
    const before = fs.readFileSync(file)
    const result = await restoreLibraryBackup(selected, f.session)
    assert.equal(result.ok, false)
    assert.equal(result.committed, false, '修订不可读取的恢复点必须在替换活动库前拒绝')
    assert.equal(result.error, '数据库或快照结构无法读取')
    assert.deepEqual(f.events, [])
    assert.deepEqual(fs.readFileSync(file), before)
    assert.equal(f.active()?.getSnapshotRevision(), 2)
    assert.deepEqual(f.active()?.loadSnapshot()?.tagPresets, ['active'])
  } finally { f.dispose() }
}

export async function testRotatingBackupRetainsCurrentSnapshotAfterClockMovesBack() {
  const f = await isolatedSession()
  try {
    f.first.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['previous'] })
    for (let day = 1; day <= 7; day++) {
      assert.ok(writeLibraryBackup(f.first, Date.UTC(2100, 0, day)))
    }
    f.first.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['current'] })
    const manual = await createVerifiedBackup(f.first, { rotate: true })
    assert.equal(manual?.status, 'verified', '轮换后刚创建的恢复点必须仍可校验')
    assert.ok(manual && fs.existsSync(manual.path))
    assert.equal(listBackups(f.first).length, 7)
    rotateBackups(f.first.getPaths().backups, { preserve: manual.path, maxTotalSize: 1 })
    assert.deepEqual(listBackups(f.first).map(backup => backup.name), [path.basename(manual.path)])
    const restored = await restoreLibraryBackup(manual.path, f.session)
    assert.ok(restored.ok)
    assert.deepEqual(restored.snapshot.tagPresets, ['current'])
  } finally { f.dispose() }
}

export async function testCreatedBackupReportsItsOwnDiskVerificationAndPreservesRetentionPolicy() {
  const f = await isolatedSession()
  try {
    f.first.saveSnapshot(createEmptyPersistedSnapshot())
    for (let day = 1; day <= 7; day++) writeLibraryBackup(f.first, Date.UTC(2024, 0, day))
    const names = () => fs.readdirSync(f.first.getPaths().backups).filter(name => name.endsWith('.db'))
    const safety = await createVerifiedBackup(f.first)
    assert.equal(safety?.status, 'verified')
    assert.equal(names().length, 8, '恢复事务在完成前必须保留现有备份')
    const manual = await createVerifiedBackup(f.first, { rotate: true })
    assert.ok(manual)
    const { path: file, ...verification } = manual
    assert.equal(verification.status, 'verified')
    assert.equal(names().length, 7)
    assert.deepEqual(JSON.parse(fs.readFileSync(file + '.meta.json', 'utf8')).verification, verification)
    f.first.exportSnapshotDatabaseBytes = () => Buffer.from('unreadable snapshot')
    const invalid = await createVerifiedBackup(f.first)
    assert.equal(invalid?.status, 'invalid', '备份已写出时，必须返回实际校验失败')
    assert.ok(invalid?.error && fs.existsSync(invalid.path))
    f.first.exportSnapshotDatabaseBytes = () => { throw new Error('cannot create snapshot') }
    assert.equal(await createVerifiedBackup(f.first), null, '创建失败须与校验失败区分')
  } finally { f.dispose() }
}

export async function testBackupListSelectionExpiresWhenTheSameDirectoryIsReopened() {
  const f = await isolatedSession()
  try {
    const snapshot = createEmptyPersistedSnapshot()
    f.first.saveSnapshot({ ...snapshot, tagPresets: ['historical'] })
    assert.ok(writeLibraryBackup(f.first))
    const [selected] = listBackups(f.first)
    f.first.saveSnapshot({ ...snapshot, tagPresets: ['current'] })
    await f.gate.runExclusive(async () => {
      f.session.close(f.first)
      await f.session.reopen()
    })
    const reopened = f.active()!
    const [fresh] = listBackups(reopened)
    assert.equal(fresh.name, selected.name)
    assert.notEqual(fresh.lifecycleId, selected.lifecycleId)
    const stale = await restoreLibraryBackup(selected, f.session)
    assert.deepEqual(stale, { ok: false, committed: false, error: '备份列表已过期，请刷新后重试' })
    assert.deepEqual(f.events, ['close', 'reopen'])
    assert.deepEqual(reopened.loadSnapshot()?.tagPresets, ['current'])
    const valid = await restoreLibraryBackup(fresh, f.session)
    assert.ok(valid.ok)
    assert.deepEqual(valid.snapshot.tagPresets, ['historical'])
  } finally { f.dispose() }
}

export async function testForeignBackupReferenceCannotSelectALocalBackupWithTheSameName() {
  const source = await isolatedSession()
  const current = await isolatedSession()
  try {
    const snapshot = createEmptyPersistedSnapshot()
    const timestamp = Date.UTC(2024, 0, 1)
    source.first.saveSnapshot({ ...snapshot, tagPresets: ['source'] })
    current.first.saveSnapshot({ ...snapshot, tagPresets: ['earlier'] })
    const foreign = writeLibraryBackup(source.first, timestamp)
    const local = writeLibraryBackup(current.first, timestamp)
    assert.ok(foreign && local)
    assert.equal(path.basename(foreign), path.basename(local))
    current.first.saveSnapshot({ ...snapshot, tagPresets: ['current'] })
    const sidecar = fs.readFileSync(local + '.meta.json')
    const verification = await verifyBackupAtPath(current.root, foreign, current.first.readManifest().libraryId)
    const restored = await restoreLibraryBackup(foreign, current.session)
    assert.deepEqual([verification.status, restored.ok, restored.committed], ['invalid', false, false],
      '带库路径的回执不得验证或恢复另一库的同名备份')
    assert.deepEqual(current.events, [])
    assert.deepEqual(fs.readFileSync(local + '.meta.json'), sidecar)
    assert.equal(restoreBackupAtPath(current.root, foreign), false)
    assert.equal(deleteBackupAtPath(current.root, foreign), false)
    assert.ok(fs.existsSync(local) && fs.existsSync(foreign))
    assert.deepEqual(current.first.loadSnapshot()?.tagPresets, ['current'])
    for (const reference of [path.basename(local), local]) {
      assert.equal((await verifyBackupAtPath(current.root, reference)).status, 'verified')
    }
  } finally { current.dispose(); source.dispose() }
}

export async function testBackupFromAnotherLibraryCannotReplaceActiveLibraryIdentity() {
  const original = await isolatedSession()
  const other = await isolatedSession()
  try {
    other.first.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['other library'] })
    const foreign = writeLibraryBackup(other.first)
    assert.ok(foreign)
    original.first.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['active library'] })
    const paths = original.first.getPaths()
    fs.cpSync(other.first.getPaths().backups, paths.backups, { recursive: true })
    const database = fs.readFileSync(paths.dbFile)
    const manifest = fs.readFileSync(paths.manifestFile)
    const restored = await restoreLibraryBackup(path.basename(foreign), original.session)
    assert.equal(restored.ok, false, '其他资料库的有效备份必须在关闭当前库之前拒绝')
    assert.equal(restored.committed, false)
    assert.deepEqual(original.events, [])
    assert.deepEqual(fs.readFileSync(paths.dbFile), database)
    assert.deepEqual(fs.readFileSync(paths.manifestFile), manifest)
    original.first.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['still writable'] }, 1)
  } finally { other.dispose(); original.dispose() }
}

export async function testRestoreInstallsTheExactBackupThatWasVerifiedBeforeTheSafetyCopy() {
  const f = await isolatedSession()
  try {
    const base = createEmptyPersistedSnapshot()
    f.first.importAsset('chart', 'application/octet-stream', Buffer.from('selected image'))
    f.first.saveSnapshot({ ...base, tagPresets: ['selected'] })
    const selected = writeLibraryBackup(f.first, Date.UTC(2024, 0, 1))
    assert.ok(selected)
    f.first.saveSnapshot({ ...base, tagPresets: ['later version'] })
    const later = writeLibraryBackup(f.first, Date.UTC(2024, 0, 2))
    assert.ok(later)
    // 历史恢复点按原文件名保存原图，其清单没有内容摘要。
    const metadata = JSON.parse(fs.readFileSync(selected + '.meta.json', 'utf8'))
    const image = metadata.attachmentEntries[0]
    const vault = path.join(f.first.getPaths().backups, 'assets')
    fs.copyFileSync(path.join(vault, image.vaultName), path.join(vault, image.fileName))
    delete metadata.attachmentEntries
    delete metadata.databaseSha256
    metadata.attachmentFiles = [image.fileName]
    fs.writeFileSync(selected + '.meta.json', JSON.stringify(metadata))

    const close = f.session.close
    f.session.close = current => {
      close(current)
      fs.copyFileSync(later, selected)
      fs.writeFileSync(path.join(vault, image.fileName), 'replaced image')
    }
    const restored = await restoreLibraryBackup(selected, f.session)
    assert.ok(restored.ok)
    assert.deepEqual(restored.snapshot.tagPresets, ['selected'], '确认后必须安装预检通过的私有副本')
    assert.equal(restored.revision, 1)
    assert.deepEqual(Buffer.from(f.active()!.getAssetBytes('chart')!.bytes), Buffer.from('selected image'))
    assert.deepEqual(f.events, ['close', 'reopen'])
    assert.equal(fs.readdirSync(f.root).some(name => name.startsWith('.backup-verify-')), false)
  } finally { f.dispose() }
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFullPersistedSnapshotFixture } from '../../src/storage/fixtures/fullPersistedSnapshot'
import { LibraryStorage } from './storage'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshot(liveId: string, marker = 'stable') {
  const value = createFullPersistedSnapshotFixture({
    trade: liveId,
    weeklyReview: liveId,
    quickNote: liveId,
    shared: liveId,
  })
  value.profile = { avatarId: null, displayName: marker }
  return value
}

async function createFixture(root: string): Promise<LibraryStorage> {
  const storage = new LibraryStorage(root)
  await storage.open()
  storage.importAsset('shared-live', 'image/png', Buffer.from('shared-live'))
  storage.importAsset('orphan-a', 'image/png', Buffer.from('orphan-a'))
  storage.importAsset('orphan-b', 'image/png', Buffer.from('orphan-b'))
  storage.saveSnapshot(snapshot('shared-live'))
  return storage
}

function writeTrashOperation(
  root: string,
  operationId: string,
  files: Array<{ id: string; fileName: string; body?: string }>,
): string {
  const operationDir = path.join(root, '.trash', operationId)
  fs.mkdirSync(operationDir, { recursive: true })
  fs.writeFileSync(path.join(operationDir, 'manifest.json'), JSON.stringify({
    version: 1,
    operationId,
    files: files.map(({ id, fileName }) => ({ id, fileName })),
  }), 'utf8')
  for (const file of files) {
    if (file.body !== undefined) fs.writeFileSync(path.join(operationDir, file.fileName), file.body)
  }
  return operationDir
}

export async function testElectronAssetGcIsRecoverableAndNeverTouchesBackups(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-gc-'))
  let storage = await createFixture(root)
  const paths = storage.getPaths()
  const backupSentinel = path.join(paths.backups, 'vault-sentinel.bin')
  // 与待清理附件正文相同，证明 GC 不能按内容/hash 误删备份库文件。
  fs.writeFileSync(backupSentinel, Buffer.from('orphan-a'))
  const backupBefore = fs.readFileSync(backupSentinel)
  try {
    for (const mutate of [
      (value: ReturnType<LibraryStorage['previewAssetPurge']>) => { value.revision += 1 },
      (value: ReturnType<LibraryStorage['previewAssetPurge']>) => { value.candidateIds.reverse() },
      (value: ReturnType<LibraryStorage['previewAssetPurge']>) => { value.totalBytes += 1 },
    ]) {
      const original = storage.previewAssetPurge()
      const tampered = { ...original, candidateIds: [...original.candidateIds] }
      mutate(tampered)
      let tamperRejected = false
      try { await storage.commitAssetPurge(tampered) } catch { tamperRejected = true }
      assert(tamperRejected, '篡改 revision/candidateIds/totalBytes 必须拒绝')
      let replayRejected = false
      try { await storage.commitAssetPurge(original) } catch { replayRejected = true }
      assert(replayRejected, '无效尝试也必须消费一次性 preview，阻止重放')
    }

    const stale = storage.previewAssetPurge()
    storage.saveSnapshot(snapshot('shared-live', 'changed-after-preview'))
    let rejected = false
    try { await storage.commitAssetPurge(stale) } catch { rejected = true }
    assert(rejected, '快照在预览后变化时必须零删除')
    assert(storage.getAssetBytes('orphan-a') && storage.getAssetBytes('orphan-b'), 'stale 预览不得删除附件')
    storage.saveSnapshot(snapshot('shared-live'))

    const renamePreview = storage.previewAssetPurge()
    const originalCopy = fs.copyFileSync
    let attachmentCopies = 0
    fs.copyFileSync = ((source, target, mode) => {
      if (String(source).includes(`${path.sep}attachments${path.sep}`) && ++attachmentCopies === 2) {
        throw new Error('forced second attachment copy failure')
      }
      return originalCopy(source, target, mode)
    }) as typeof fs.copyFileSync
    rejected = false
    try { await storage.commitAssetPurge(renamePreview) } catch { rejected = true } finally {
      fs.copyFileSync = originalCopy
    }
    assert(rejected, '第 N 个附件 trash 复制失败必须拒绝清理')
    assert(storage.getAssetBytes('orphan-a') && storage.getAssetBytes('orphan-b'), '复制失败时活动附件必须始终保留')

    storage.close()
    storage = new LibraryStorage(root)
    await storage.open()
    assert(!fs.existsSync(path.join(root, '.trash')), '重启必须幂等清理已搬回操作清单')

    const dbFailurePreview = storage.previewAssetPurge()
    const originalOpen = fs.openSync
    const originalFsync = fs.fsyncSync
    const dbTempDescriptors = new Set<number>()
    fs.openSync = ((filePath: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      const descriptor = originalOpen(filePath, flags, mode)
      if (path.basename(String(filePath)).startsWith('.journal.db.')) dbTempDescriptors.add(descriptor)
      return descriptor
    }) as typeof fs.openSync
    fs.fsyncSync = ((descriptor: number) => {
      if (dbTempDescriptors.has(descriptor)) throw new Error('forced database temp fsync failure')
      return originalFsync(descriptor)
    }) as typeof fs.fsyncSync
    rejected = false
    try { await storage.commitAssetPurge(dbFailurePreview) } catch { rejected = true } finally {
      fs.openSync = originalOpen
      fs.fsyncSync = originalFsync
    }
    assert(rejected, '数据库耐久落盘失败必须拒绝清理')
    assert(storage.getAssetBytes('orphan-a') && storage.getAssetBytes('orphan-b'), 'DB 失败必须恢复附件与数据库行')

    storage.close()
    storage = new LibraryStorage(root)
    await storage.open()

    const beforeDbCrashDir = writeTrashOperation(root, 'crash-before-db', [
      { id: 'orphan-b', fileName: 'orphan-b.png' },
    ])
    fs.renameSync(
      path.join(paths.attachments, 'orphan-b.png'),
      path.join(beforeDbCrashDir, 'orphan-b.png'),
    )
    storage.close()
    storage = new LibraryStorage(root)
    await storage.open()
    assert(storage.getAssetBytes('orphan-b'), 'DB 行仍在时重启必须把 trash 附件搬回活动目录')
    assert(!fs.existsSync(path.join(root, '.trash')), 'crash-before-db 恢复后必须清理操作目录')

    const outsideDir = path.join(root, 'outside-dir')
    const outside = path.join(outsideDir, 'outside-sentinel.bin')
    fs.mkdirSync(outsideDir)
    fs.writeFileSync(outside, 'outside')
    const symlinkPreview = storage.previewAssetPurge()
    const realAttachments = path.join(root, 'attachments-real')
    fs.renameSync(paths.attachments, realAttachments)
    fs.symlinkSync(outsideDir, paths.attachments, process.platform === 'win32' ? 'junction' : 'dir')
    rejected = false
    try { await storage.commitAssetPurge(symlinkPreview) } catch { rejected = true }
    assert(rejected, '预览后把 attachments 替换为 symlink/junction 必须 fail-closed')
    assert(fs.readFileSync(outside, 'utf8') === 'outside', 'symlink 拒绝不得触碰库外目标')
    fs.rmSync(paths.attachments)
    fs.renameSync(realAttachments, paths.attachments)

    const preview = storage.previewAssetPurge()
    const result = await storage.commitAssetPurge(preview)
    assert(result.deletedIds.join(',') === 'orphan-a,orphan-b', '成功清理必须精确删除预览 orphan')
    assert(storage.getAssetBytes('orphan-a') === null && storage.getAssetBytes('orphan-b') === null, '成功后数据库行与活动文件必须消失')
    assert(storage.getAssetBytes('shared-live'), '三个富文本域共享附件必须保留')
    assert(storage.previewAssetPurge().candidateIds.length === 0, '成功后再次扫描 orphan 必须为零')
    if (process.platform === 'win32') {
      assert(fs.existsSync(path.join(root, '.trash', preview.operationId)), 'Windows 无目录 fsync 时必须保留恢复日志到下次启动')
      assert(fs.existsSync(path.join(paths.attachments, 'orphan-a.png')), 'Windows 延迟收尾前必须保留活动附件原件')
    }

    const crashDir = writeTrashOperation(root, 'crash-after-db', [
      { id: 'orphan-a', fileName: 'orphan-a.png', body: 'orphan-a' },
      { id: 'orphan-b', fileName: 'orphan-b.png', body: 'orphan-b' },
    ])
    assert(fs.existsSync(crashDir), '必须建立 DB 已提交但 trash 未清理的恢复样本')
    storage.close()
    storage = new LibraryStorage(root)
    await storage.open()
    assert(!fs.existsSync(path.join(root, '.trash')), '重启必须完成 DB 已提交后的物理删除')
    assert(!fs.existsSync(path.join(paths.attachments, 'orphan-a.png')), '已提交清理不得把 trash 文件搬回')
    assert(fs.readFileSync(backupSentinel).equals(backupBefore), '整个 GC 与恢复过程不得修改 backups vault')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testElectronAssetGcRecoveryRejectsUnsafeTrashState(): Promise<void> {
  const expectOpenRejected = async (root: string, message: string): Promise<void> => {
    const candidate = new LibraryStorage(root)
    let rejected = false
    try { await candidate.open() } catch { rejected = true } finally { candidate.close() }
    assert(rejected, message)
  }

  const junctionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-gc-junction-'))
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-gc-outside-'))
  let junctionStorage = await createFixture(junctionRoot)
  const junctionPaths = junctionStorage.getPaths()
  junctionStorage.close()
  const operationDir = writeTrashOperation(junctionRoot, 'startup-junction', [
    { id: 'orphan-a', fileName: 'orphan-a.png' },
  ])
  fs.renameSync(path.join(junctionPaths.attachments, 'orphan-a.png'), path.join(operationDir, 'orphan-a.png'))
  const realAttachments = path.join(junctionRoot, 'attachments-real')
  const outsideSentinel = path.join(outsideRoot, 'outside.txt')
  fs.writeFileSync(outsideSentinel, 'outside', 'utf8')
  fs.renameSync(junctionPaths.attachments, realAttachments)
  fs.symlinkSync(outsideRoot, junctionPaths.attachments, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    await expectOpenRejected(junctionRoot, '启动恢复遇到 attachments junction 必须 fail-closed')
    assert(fs.readFileSync(outsideSentinel, 'utf8') === 'outside', '启动恢复不得触碰 junction 指向的库外目录')
  } finally {
    fs.rmSync(junctionPaths.attachments)
    fs.renameSync(realAttachments, junctionPaths.attachments)
    fs.rmSync(junctionRoot, { recursive: true, force: true })
    fs.rmSync(outsideRoot, { recursive: true, force: true })
  }

  const traversalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-gc-traversal-'))
  let traversalStorage = await createFixture(traversalRoot)
  traversalStorage.close()
  try {
    writeTrashOperation(traversalRoot, 'manifest-traversal', [
      { id: 'orphan-a', fileName: '../outside.bin' },
    ])
    await expectOpenRejected(traversalRoot, 'manifest 中的 ../ 路径必须阻止启动恢复')
  } finally {
    fs.rmSync(traversalRoot, { recursive: true, force: true })
  }

  const unknownRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-gc-unknown-'))
  let unknownStorage = await createFixture(unknownRoot)
  unknownStorage.close()
  try {
    const unknownOperation = writeTrashOperation(unknownRoot, 'unknown-trash-item', [])
    fs.writeFileSync(path.join(unknownOperation, 'unexpected.bin'), 'unexpected', 'utf8')
    await expectOpenRejected(unknownRoot, 'trash 操作目录中的未知文件必须阻止启动恢复')
  } finally {
    fs.rmSync(unknownRoot, { recursive: true, force: true })
  }

  const mismatchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-gc-journal-mismatch-'))
  const mismatchStorage = await createFixture(mismatchRoot)
  mismatchStorage.close()
  try {
    const mismatchOperation = writeTrashOperation(mismatchRoot, 'journal-mismatch', [
      { id: 'orphan-a', fileName: 'orphan-a.png', body: 'orphan-a' },
    ])
    fs.writeFileSync(path.join(mismatchOperation, 'cleanup.json'), JSON.stringify({
      version: 1,
      operationId: 'journal-mismatch',
      files: [{ id: 'orphan-b', fileName: 'orphan-b.png' }],
    }), 'utf8')
    await expectOpenRejected(mismatchRoot, 'manifest 与 cleanup 内容不一致必须在任何文件动作前拒绝')
    assert(fs.existsSync(path.join(mismatchOperation, 'orphan-a.png')), '双 journal 不一致不得修改 staged 文件')
    assert(fs.existsSync(path.join(mismatchRoot, 'attachments', 'orphan-a.png')), '双 journal 不一致不得修改活动附件')
    fs.writeFileSync(path.join(mismatchOperation, 'cleanup.json'), '{invalid', 'utf8')
    await expectOpenRejected(mismatchRoot, 'manifest 合法时也不得忽略损坏的 cleanup journal')
    assert(fs.existsSync(path.join(mismatchOperation, 'orphan-a.png')), '损坏 cleanup journal 必须零修改 fail-closed')
  } finally {
    fs.rmSync(mismatchRoot, { recursive: true, force: true })
  }

  const cleanupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-gc-cleanup-tail-'))
  let cleanupStorage = await createFixture(cleanupRoot)
  const cleanupPreview = cleanupStorage.previewAssetPurge()
  await cleanupStorage.commitAssetPurge(cleanupPreview)
  cleanupStorage.close()
  cleanupStorage = new LibraryStorage(cleanupRoot)
  await cleanupStorage.open()
  cleanupStorage.close()
  try {
    const cleanupOperation = writeTrashOperation(cleanupRoot, 'cleanup-tail', [
      { id: 'orphan-a', fileName: 'orphan-a.png', body: 'orphan-a' },
    ])
    fs.copyFileSync(
      path.join(cleanupOperation, 'manifest.json'),
      path.join(cleanupOperation, 'cleanup.json'),
    )
    fs.rmSync(path.join(cleanupOperation, 'manifest.json'))
    const originalRm = fs.rmSync
    let interrupted = false
    fs.rmSync = ((target, options) => {
      if (!interrupted && path.resolve(String(target)) === path.resolve(cleanupOperation, 'orphan-a.png')) {
        interrupted = true
        throw new Error('forced ordered cleanup interruption')
      }
      return originalRm(target, options as never)
    }) as typeof fs.rmSync
    const interruptedCandidate = new LibraryStorage(cleanupRoot)
    let rejected = false
    try { await interruptedCandidate.open() } catch { rejected = true } finally {
      interruptedCandidate.close()
      fs.rmSync = originalRm
    }
    assert(rejected && interrupted, 'staged 删除中断必须保留可重试恢复状态')
    assert(fs.existsSync(path.join(cleanupOperation, 'cleanup.json')), '数据文件清完前 cleanup journal 不得删除')
    const cleanupCandidate = new LibraryStorage(cleanupRoot)
    try { await cleanupCandidate.open() } finally { cleanupCandidate.close() }
  } catch (error) {
    throw new Error(`仅 cleanup journal 的恢复必须成功：${error instanceof Error ? error.message : String(error)}`)
  }
  assert(!fs.existsSync(path.join(cleanupRoot, '.trash')), 'cleanup journal 中断态必须在一次启动内收敛')
  fs.mkdirSync(path.join(cleanupRoot, '.trash', 'empty-tail'), { recursive: true })
  const emptyCandidate = new LibraryStorage(cleanupRoot)
  try {
    await emptyCandidate.open()
    assert(!fs.existsSync(path.join(cleanupRoot, '.trash')), 'manifest 删除后的空操作目录必须幂等收敛')
  } finally {
    emptyCandidate.close()
    fs.rmSync(cleanupRoot, { recursive: true, force: true })
  }
}

export async function testElectronAssetGcIpcUsesTheExclusiveLibraryGate(): Promise<void> {
  const source = fs.readFileSync('electron/library/ipc.ts', 'utf8')
  const recoveryStart = source.indexOf("ipcMain.handle('storage:prepareAssetPurgeRecovery'")
  const start = source.indexOf("ipcMain.handle('storage:commitAssetPurge'")
  const end = source.indexOf("ipcMain.handle('", start + 20)
  const handler = source.slice(start, end)
  const recoveryHandler = source.slice(recoveryStart, start)
  assert(start >= 0 && handler.includes('operationGate.runExclusive'), 'Electron purge IPC 必须使用 exclusive gate')
  assert(handler.includes('ATLAS_ENABLE_ASSET_PURGE_COMMIT'), 'Electron 主进程必须默认关闭实际删除边界')
  assert(handler.includes('assetPurgeAuthorizations') && handler.includes('payload.authorization'), 'Electron 删除必须消费恢复归档一次性授权')
  assert(
    recoveryStart >= 0 &&
    recoveryHandler.includes('operationGate.runExclusive') &&
    recoveryHandler.includes('exportJournalZip') &&
    recoveryHandler.includes('importJournalZipToPath') &&
    recoveryHandler.indexOf('importJournalZipToPath') < recoveryHandler.indexOf('randomUUID'),
    'Electron 必须独占导出并验证恢复归档后才能签发授权',
  )
}
// Quality-Scenario: A-ELEC-DBFAIL
// Quality-Scenario: A-ELEC-POSTDB-CRASH
// Quality-Scenario: A-ELEC-PATH

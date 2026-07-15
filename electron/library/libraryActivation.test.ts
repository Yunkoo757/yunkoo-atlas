import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PersistedSnapshot } from '../../src/storage/types'
import { areSameLibrary, openValidatedLibraryCandidate } from './libraryActivation'
import { LibraryStorage } from './storage'
import { currentTestSnapshot } from './testSnapshot'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function snapshot(): PersistedSnapshot {
  return currentTestSnapshot()
}

export async function testLibraryStorageRejectsInvalidSnapshotBeforeDiskWrite(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-invalid-candidate-'))
  const writer = new LibraryStorage(root)
  try {
    await writer.open()
    writer.saveSnapshot(snapshot())
    let rejected = false
    try {
      writer.saveSnapshot({ ...snapshot(), trades: [{ id: 'invalid' }] } as unknown as PersistedSnapshot)
    } catch {
      rejected = true
    }
    assert(rejected, '无效快照必须在覆盖资料库前拒绝')
    assert(writer.loadSnapshot()?.trades.length === 0, '拒绝无效快照后原资料库必须保持不变')
  } finally {
    writer.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testCandidateLibraryRejectsFutureSchemaBeforeActivation(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-future-candidate-'))
  const writer = new LibraryStorage(root)
  try {
    await writer.open()
    writer.saveSnapshot(snapshot())
    writer.release()
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({ schemaVersion: 999, libraryId: 'future-library' }),
      'utf8',
    )

    let rejected = false
    try {
      await openValidatedLibraryCandidate(new LibraryStorage(root))
    } catch {
      rejected = true
    }
    assert(rejected, '高于当前版本的候选库必须在激活前拒绝')
  } finally {
    writer.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testCandidateLibraryAllowsNewEmptyLibrary(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-empty-candidate-'))
  const candidate = new LibraryStorage(root)
  try {
    const loaded = await openValidatedLibraryCandidate(candidate)
    assert(loaded === null, '新建空库没有快照时应保持兼容')
  } finally {
    candidate.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testWindowsJunctionAliasIsRecognizedAsTheActiveLibrary(): Promise<void> {
  if (process.platform !== 'win32') return

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-library-alias-'))
  const target = path.join(parent, 'library')
  const alias = path.join(parent, 'library-alias')
  const source = new LibraryStorage(target)
  let candidate: LibraryStorage | null = null
  try {
    await source.open()
    source.saveSnapshot(snapshot())
    fs.symlinkSync(target, alias, 'junction')

    candidate = new LibraryStorage(alias)
    await openValidatedLibraryCandidate(candidate)

    assert(
      areSameLibrary(source, candidate),
      '同一交易库的 Windows junction 别名必须被识别为当前库，不能进入切换流程',
    )
  } finally {
    candidate?.release()
    source.release()
    fs.rmSync(parent, { recursive: true, force: true })
  }
}

export function testIpcDoesNotPersistOrActivateCandidateBeforeValidation(): void {
  const source = fs.readFileSync(path.resolve('electron/library/ipc.ts'), 'utf8')
  const candidateStart = source.indexOf('async function openLibrarySwitchCandidate(')
  const validation = source.indexOf('await openValidatedLibraryCandidate(candidate)', candidateStart)
  const activationHelper = source.indexOf('function activateLibraryCandidate(')
  const activationIdentityCheck = source.indexOf('areSameLibrary(storage, candidate)', activationHelper)
  const saveConfig = source.indexOf('saveLibraryConfig({ libraryPath: resolvedPath })', activationHelper)
  const activate = source.indexOf('storage = candidate', activationHelper)
  const prepareStart = source.indexOf('async function prepareActiveLibrarySwitch(')
  const activatePreparedStart = source.indexOf('async function activatePreparedLibrarySwitch(')
  const prepareBody = source.slice(prepareStart, activatePreparedStart)
  const activatePreparedBody = source.slice(activatePreparedStart, source.indexOf('function cancelPreparedLibrarySwitch('))

  assert(candidateStart >= 0 && validation > candidateStart, '切库准备阶段必须调用候选库完整校验')
  assert(saveConfig > validation, '候选库校验通过前不得写入 library-config')
  assert(activationIdentityCheck > activationHelper && activationIdentityCheck < saveConfig, '任何激活入口都必须在改配置前拒绝当前库别名')
  assert(activate > saveConfig, '配置成功前不得替换当前内存 storage')
  assert(!prepareBody.includes('saveLibraryConfig('), '准备候选库时旧库与配置必须保持活跃')
  assert(!prepareBody.includes('storage = candidate'), '准备候选库时不得提前替换当前 storage')
  assert(prepareBody.includes("if (mode === 'open')"), '只有打开现有库时才应在准备阶段实例化候选库')
  assert(prepareBody.includes('validated.candidate.release()'), '准备校验后必须立即释放候选 DB，不能缓存旧版本')
  assert(prepareBody.includes('attachPreparedLibraryLease'), '候选令牌必须绑定 owner 与过期租约')
  assert(activatePreparedBody.includes('current !== prepared.sourceStorage'), '激活前必须确认准备期间旧库未被替换')
  assert(
    activatePreparedBody.includes('openLibrarySwitchCandidate(prepared.resolvedPath, prepared.mode)'),
    '激活阶段必须重新打开目标库，读取 prepare 后的云盘更新',
  )
  assert(activatePreparedBody.includes('areSameLibrary(current, fresh.candidate)'), '激活阶段必须再次确认候选库不是当前库')
  assert(activatePreparedBody.includes('activateLibraryCandidate(fresh)'), '只有激活阶段才能替换新鲜候选库')
  assert(source.includes('prepared.ownerWebContentsId !== event.sender.id'), '令牌不得被其他 renderer 激活')
  assert(source.includes('PREPARED_LIBRARY_TTL_MS'), '遗弃令牌必须自动过期')
  assert(source.includes("sender.once('render-process-gone', expire)"), 'renderer 崩溃时必须回收令牌')
  assert(source.includes('const rollbackError = restorePreviousBackup()'), '候选启动或配置失败必须恢复旧库自动备份')
}

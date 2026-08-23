import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import { SCHEMA_VERSION, type PersistedSnapshot } from '../../src/storage/types'
import {
  areSameLibrary,
  assertCompatibleManifest,
  openValidatedLibraryCandidate,
  reloadRendererAfterStorageRecovery,
  recoverLibraryStorageLifecycle,
} from './libraryActivation'
import { LibraryStorage } from './storage'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { LibraryBusyError, LibraryOperationGate } from './sessionGate'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function snapshot(): PersistedSnapshot {
  return {
    ...createEmptyPersistedSnapshot(),
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }
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

export async function testDefaultLibraryOpenRejectsFutureSchema(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-future-default-open-'))
  const writer = new LibraryStorage(root)
  try {
    await writer.open()
    writer.saveSnapshot(snapshot())
    writer.release()
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, libraryId: 'future-default' }),
      'utf8',
    )

    const candidate = new LibraryStorage(root)
    let rejected = false
    try {
      await candidate.open()
      assertCompatibleManifest(candidate.readManifest())
    } catch {
      rejected = true
    } finally {
      candidate.release()
    }
    assert(rejected, '默认开库路径必须拒绝未来 schema，不得进入可写会话')
  } finally {
    writer.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testEnsureStorageRejectsFutureSchemaBeforeActivation(): void {
  const source = fs.readFileSync(path.resolve('electron/library/ipc.ts'), 'utf8')
  const ensureStart = source.indexOf('async function ensureStorage(')
  const ensureEnd = source.indexOf('function withStorage', ensureStart)
  const body = source.slice(ensureStart, ensureEnd)
  assert(ensureStart >= 0 && ensureEnd > ensureStart, 'ensureStorage 实现必须存在')
  assert(
    body.includes('const manifest = candidate.readManifest()') &&
      body.includes('assertCompatibleManifest(manifest)'),
    '默认 storage:open 路径必须复用未来 schema 拒写',
  )
  assert(
    body.indexOf('await candidate.open()') < body.indexOf('assertCompatibleManifest'),
    '必须先 open 再校验清单，且校验失败不得激活 storage',
  )
  assert(
    body.indexOf('assertCompatibleManifest') < body.indexOf('storage = candidate'),
    '未来 schema 校验通过前不得把候选库赋给全局 storage',
  )
  assert(
    body.indexOf('manifest.libraryId !== location.verifiedLibraryId') < body.indexOf('storage = candidate'),
    '位置验证与正式打开之间必须再次核对资料库 identity',
  )
}

export function testIpcDoesNotPersistOrActivateCandidateBeforeValidation(): void {
  const source = fs.readFileSync(path.resolve('electron/library/ipc.ts'), 'utf8')
  const candidateStart = source.indexOf('async function openLibrarySwitchCandidate(')
  const validation = source.indexOf('await openValidatedLibraryCandidate(candidate)', candidateStart)
  const activationHelper = source.indexOf('function activateLibraryCandidate(')
  const activationIdentityCheck = source.indexOf('areSameLibrary(storage, candidate)', activationHelper)
  const saveConfig = source.indexOf('saveLibraryConfig({', activationHelper)
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
    '激活阶段必须重新打开目标库，读取 prepare 后的磁盘最新版本',
  )
  assert(activatePreparedBody.includes('areSameLibrary(current, fresh.candidate)'), '激活阶段必须再次确认候选库不是当前库')
  assert(activatePreparedBody.includes('activateLibraryCandidate(fresh)'), '只有激活阶段才能替换新鲜候选库')
  assert(source.includes('prepared.ownerWebContentsId !== event.sender.id'), '令牌不得被其他 renderer 激活')
  assert(source.includes('PREPARED_LIBRARY_TTL_MS'), '遗弃令牌必须自动过期')
  assert(source.includes("sender.once('render-process-gone', expire)"), 'renderer 崩溃时必须回收令牌')
  assert(source.includes('const rollbackError = restorePreviousBackup()'), '候选启动或配置失败必须恢复旧库自动备份')
}

export async function testRecoveryReplacesIndeterminateStorageBeforeRendererReload(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-library-lifecycle-recovery-'))
  let injectIndeterminate = false
  const previous = new LibraryStorage(root, {
    afterSnapshotAtomicReplace: (targetPath) => {
      if (!injectIndeterminate) return
      fs.appendFileSync(targetPath, Buffer.from([0xff]))
      throw new Error('injected indeterminate storage write')
    },
  })
  let active: LibraryStorage = previous
  let rendererReloaded = false
  try {
    await previous.open()
    const before = snapshot()
    before.tagPresets = ['before-recovery']
    previous.saveSnapshot(before)

    const diskCandidate = snapshot()
    diskCandidate.tagPresets = ['disk-recovery-truth']
    injectIndeterminate = true
    try { previous.saveSnapshot(diskCandidate) } catch { /* expected recovery lock */ }

    let locked = false
    try { previous.loadSnapshot() } catch { locked = true }
    assert(locked, 'fixture 必须先把旧 LibraryStorage 放入 indeterminate recovery lock')

    const recovered = await recoverLibraryStorageLifecycle({
      current: previous,
      createCandidate: (libraryPath) => new LibraryStorage(libraryPath, {
        ensureDirectories: false,
        allowCreate: false,
      }),
      activateCandidate: (candidate) => { active = candidate },
      reloadRenderer: () => {
        assert(active !== previous, 'renderer reload 前必须先替换旧主进程 storage 实例')
        assert(
          active.loadSnapshot()?.tagPresets?.[0] === 'disk-recovery-truth',
          'renderer reload 前新实例必须已经从磁盘读取恢复真相',
        )
        rendererReloaded = true
      },
    })

    assert(recovered.storage === active && active !== previous, '恢复结果必须暴露全新的活动 storage')
    assert(recovered.snapshot?.tagPresets?.[0] === 'disk-recovery-truth', '恢复结果必须来自 fresh disk load')
    assert(rendererReloaded, '只有 fresh storage 激活后才可触发 renderer reload')
    let oldLifecycleStillLocked = false
    try { previous.loadSnapshot() } catch { oldLifecycleStillLocked = true }
    assert(oldLifecycleStillLocked, '恢复不得复用携带 recovery error 的旧实例')
  } finally {
    active.release()
    if (active !== previous) previous.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testRecoveryCanBootstrapFreshStorageWhenBackupCutoverLeftNoActiveInstance(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-library-null-lifecycle-recovery-'))
  const writer = new LibraryStorage(root)
  let active: LibraryStorage | null = null
  let rendererReloaded = false
  try {
    await writer.open()
    const durable = snapshot()
    durable.tagPresets = ['backup-cutover-disk-truth']
    writer.saveSnapshot(durable)
    const libraryId = writer.readManifest().libraryId
    writer.release()

    const recovered = await recoverLibraryStorageLifecycle({
      current: null,
      libraryPath: root,
      expectedLibraryId: libraryId,
      createCandidate: (libraryPath) => new LibraryStorage(libraryPath, {
        ensureDirectories: false,
        allowCreate: false,
      }),
      activateCandidate: (candidate) => { active = candidate },
      reloadRenderer: () => {
        assert(active !== null, '无活动实例恢复也必须先激活 fresh storage 再刷新')
        rendererReloaded = true
      },
    })

    assert(recovered.storage === active, '恢复结果必须返回从 verified disk 新建的活动实例')
    assert(recovered.snapshot?.tagPresets?.[0] === 'backup-cutover-disk-truth', '必须读取 backup cutover 后磁盘真相')
    assert(rendererReloaded, '无活动实例自举成功后必须刷新 renderer')
  } finally {
    ;(active as LibraryStorage | null)?.release()
    writer.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

class FakeRecoveryRenderer extends EventEmitter {
  destroyed = false
  reloadCalls = 0
  reloadError: Error | null = null

  isDestroyed(): boolean {
    return this.destroyed
  }

  reload(): void {
    this.reloadCalls += 1
    if (this.reloadError) throw this.reloadError
  }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export async function testRecoveryReloadWaitsForMainFrameCommitBeforeReleasingExclusiveGate(): Promise<void> {
  const sender = new FakeRecoveryRenderer()
  const gate = new LibraryOperationGate()
  let settled = false
  const navigationObservations: string[] = []
  const recovery = gate.runExclusive(async () => {
    await reloadRendererAfterStorageRecovery(sender, 1_000, {
      onMainFrameNavigationStarted: () => {
        navigationObservations.push(`start:${gate.isExclusive()}`)
      },
      onMainFrameNavigationCommitted: () => {
        navigationObservations.push(`commit:${gate.isExclusive()}`)
      },
    })
    settled = true
  })
  await nextTurn()
  assert(sender.reloadCalls === 1, '恢复 helper 必须发起一次 renderer reload')

  for (const event of [
    () => sender.emit('did-start-navigation', {}, 'file:///frame', false, false),
    () => sender.emit('did-frame-navigate', {}, 'file:///frame', 200, 'OK', false),
    () => sender.emit('did-navigate-in-page', {}, 'file:///next#hash', true),
    () => sender.emit('did-fail-load', {}, -3, 'subframe aborted', 'file:///frame', false),
  ]) {
    event()
    await nextTurn()
    assert(!settled, '导航开始、in-page 或子框架事件均不得提前释放恢复独占锁')
    let busy: unknown
    try { await gate.run(() => 'stale renderer write') } catch (error) { busy = error }
    assert(busy instanceof LibraryBusyError, '旧 renderer 尾部 IPC 在主框架提交前必须被 exclusive gate 拒绝')
  }

  sender.emit('did-start-navigation', {}, 'file:///next', false, true)
  await nextTurn()
  assert(!settled, '主框架 did-start-navigation 也不得释放恢复独占锁')
  assert(navigationObservations.join(',') === 'start:true', '真实导航开始观测点必须看到 exclusive gate')
  sender.emit('did-navigate', {}, 'file:///next', 200, 'OK')
  await recovery
  assert(settled, '只有主框架 did-navigate 提交后才能完成恢复')
  assert(
    navigationObservations.join(',') === 'start:true,commit:true',
    '主框架提交回调必须在 exclusive gate 释放前执行',
  )
  assert(await gate.run(() => 'fresh renderer write') === 'fresh renderer write', '提交后 fresh renderer IPC 必须恢复')
  for (const eventName of ['did-start-navigation', 'did-navigate', 'did-fail-load', 'destroyed', 'render-process-gone']) {
    assert(sender.listenerCount(eventName) === 0, `恢复完成后必须清理 ${eventName} listener`)
  }
}

export async function testRecoveryReloadReportsTypedLifecycleFailuresAndCleansListeners(): Promise<void> {
  const cases: Array<{
    name: string
    arrange: (sender: FakeRecoveryRenderer) => void
    trigger?: (sender: FakeRecoveryRenderer) => void
    expectedMessage?: string
  }> = [
    {
      name: 'already-destroyed',
      arrange: (sender) => { sender.destroyed = true },
    },
    {
      name: 'reload-throws',
      arrange: (sender) => { sender.reloadError = new Error('reload rejected') },
    },
    {
      name: 'subframe-then-main-frame-fail-load',
      arrange: () => undefined,
      trigger: (sender) => {
        sender.emit('did-fail-load', {}, -3, 'subframe aborted', 'file:///frame', false)
        sender.emit('did-fail-load', {}, -105, 'name not resolved', 'file:///next', true)
      },
      expectedMessage: '-105',
    },
    {
      name: 'renderer-gone',
      arrange: () => undefined,
      trigger: (sender) => sender.emit('render-process-gone', {}, { reason: 'crashed' }),
    },
    {
      name: 'destroyed-during-reload',
      arrange: () => undefined,
      trigger: (sender) => sender.emit('destroyed'),
    },
  ]

  for (const failureCase of cases) {
    const sender = new FakeRecoveryRenderer()
    failureCase.arrange(sender)
    const pending = reloadRendererAfterStorageRecovery(sender, 1_000)
    failureCase.trigger?.(sender)
    let failure: unknown
    try { await pending } catch (error) { failure = error }
    assert(failure instanceof Error, `${failureCase.name} 必须返回可映射的 typed reload failure`)
    if (failureCase.expectedMessage) {
      assert(
        (failure as Error).message.includes(failureCase.expectedMessage),
        `${failureCase.name} 必须由主框架失败立即拒绝，不能丢失 listener 后等超时`,
      )
    }
    for (const eventName of ['did-start-navigation', 'did-navigate', 'did-fail-load', 'destroyed', 'render-process-gone']) {
      assert(sender.listenerCount(eventName) === 0, `${failureCase.name} 后必须清理 ${eventName} listener`)
    }
  }
}

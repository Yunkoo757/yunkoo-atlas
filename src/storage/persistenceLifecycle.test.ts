import assert from 'node:assert/strict'
import { PersistenceController, type PersistenceSaveStatus } from '@/storage/persistenceController'
import type { PersistedSnapshot } from '@/storage/types'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fixture(save: (snapshot: PersistedSnapshot) => Promise<void>) {
  let status: PersistenceSaveStatus = 'idle'
  let latest = { profile: { displayName: 'initial' } } as PersistedSnapshot
  let tick: (() => void) | undefined
  const controller = new PersistenceController({
    saveSnapshot: save,
    captureSnapshot: () => ({ snapshot: latest, stateReference: latest, shortcutReference: null }),
    clock: { setTimeout: callback => { tick = callback; return callback }, clearTimeout: () => { tick = undefined } },
    status: {
      getStatus: () => status,
      setDirty: () => { status = 'dirty' }, setSaving: () => { status = 'saving' },
      setSaved: () => { status = 'saved' }, setError: () => { status = 'error' }, reset: () => { status = 'idle' },
    },
  })
  controller.enableWrites()
  return {
    controller,
    status: () => status,
    schedule(name: string) {
      latest = { profile: { displayName: name } } as PersistedSnapshot
      controller.schedule(latest)
    },
    tick() { assert(tick); const callback = tick; tick = undefined; callback() },
  }
}

export async function testDisabledWritesCancelAnAlreadyQueuedExplicitFlush() {
  let saves = 0
  const f = fixture(async () => { saves++ })
  const flushing = f.controller.flushNow()
  f.controller.disableWrites()
  await flushing
  assert.equal(saves, 0, '关闭写入必须使尚未开始的显式保存失效')
}

export async function testLatePreflushCannotConsumeANewWriteLifecycle() {
  const started = deferred(), allow = deferred()
  const saved: string[] = []
  const f = fixture(async value => { saved.push(value.profile!.displayName) })
  f.controller.setPreFlushCallback(async () => { started.resolve(); await allow.promise })
  const old = f.controller.flushNow()
  await started.promise
  f.controller.disableWrites()
  f.controller.enableWrites()
  f.schedule('new-library')
  allow.resolve()
  await old
  assert.deepEqual(saved, [], '旧 preflush 完成后不得捕获或保存新生命周期的快照')
  assert.equal(f.status(), 'dirty')
  f.tick()
  await f.controller.flushNow()
  assert.deepEqual(saved, ['new-library', 'new-library'])
}

export async function testLateFailedSaveCannotRequeueADiscardedSnapshot() {
  const started = deferred(), allow = deferred()
  const f = fixture(async () => { started.resolve(); await allow.promise })
  const flushing = f.controller.flushNow()
  await started.promise
  f.controller.disableWrites()
  allow.reject(new Error('old disk failure'))
  await assert.rejects(flushing, /old disk failure/)
  assert.equal(f.controller.getDiagnostics().pendingSnapshotCount, 0, '旧失败不能把已丢弃快照重新排队')
  assert.notEqual(f.status(), 'error', '旧失败不能发布到新写入状态')
}

export async function testAutosaveStopsTakingPendingSnapshotsWhileSuspended() {
  const started = deferred(), allow = deferred()
  const saved: string[] = []
  const f = fixture(async value => {
    saved.push(value.profile!.displayName)
    if (saved.length === 1) { started.resolve(); await allow.promise }
  })
  f.schedule('A')
  f.tick()
  await started.promise
  f.controller.suspend()
  f.schedule('B')
  allow.resolve()
  // 等待在途写入及其 finally；不依赖宿主时钟或磁盘速度。
  for (let i = 0; i < 12; i++) await Promise.resolve()
  assert.deepEqual(saved, ['A'], '暂停期间自动保存不得开始写入 B')
  assert.equal(f.status(), 'dirty')
  await f.controller.resumeAndFlush()
  assert.deepEqual(saved, ['A', 'B'])
}

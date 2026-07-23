import { PersistenceController, type PersistenceClock } from '@/storage/persistenceController'
import type { PersistedSnapshot } from '@/storage/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshot(name: string): PersistedSnapshot {
  return { profile: { displayName: name } } as PersistedSnapshot
}

function createFakeClock(): PersistenceClock & { runLatest(): void; pendingCount(): number } {
  let nextHandle = 0
  const callbacks = new Map<number, () => void>()
  return {
    setTimeout(callback) {
      nextHandle += 1
      callbacks.set(nextHandle, callback)
      return nextHandle
    },
    clearTimeout(handle) {
      callbacks.delete(handle as number)
    },
    runLatest() {
      const entry = [...callbacks.entries()].at(-1)
      if (!entry) throw new Error('没有待执行的计时器')
      callbacks.delete(entry[0])
      entry[1]()
    },
    pendingCount() {
      return callbacks.size
    },
  }
}

async function settle(condition: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (condition()) return
    await Promise.resolve()
  }
  throw new Error(message)
}

export async function testPersistenceControllerUsesInjectedClockAndSavesOnlyLatestDebouncedSnapshot(): Promise<void> {
  const clock = createFakeClock()
  const saved: string[] = []
  let status = 'idle' as 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  const controller = new PersistenceController({
    saveSnapshot: async (value) => { saved.push(value.profile?.displayName ?? '') },
    captureSnapshot: () => ({
      snapshot: snapshot('captured'),
      stateReference: null,
      shortcutReference: null,
    }),
    status: {
      getStatus: () => status,
      setDirty: () => { status = 'dirty' },
      setSaving: () => { status = 'saving' },
      setSaved: () => { status = 'saved' },
      setError: () => { status = 'error' },
      reset: () => { status = 'idle' },
    },
    clock,
  })

  controller.enableWrites()
  controller.schedule(snapshot('A'))
  controller.schedule(snapshot('B'))

  assert(clock.pendingCount() === 1, '连续调度必须只保留一个注入计时器')
  assert(controller.getDiagnostics().pendingSnapshotCount === 1, '生产诊断必须观察到一个待提交快照槽位')
  assert(controller.getDiagnostics().maxPendingSnapshotCount === 1, '生产诊断的历史最大 pending 必须为 1')
  assert(status === 'dirty', '调度后必须标记为 dirty')
  clock.runLatest()
  await settle(() => status === 'saved', '计时器触发后应完成保存')
  assert(saved.join(',') === 'B', '防抖保存只能写入最新快照')
  assert(controller.getDiagnostics().pendingSnapshotCount === 0, '保存完成后生产诊断 pending 必须归零')
  controller.resetDiagnostics()
  assert(controller.getDiagnostics().maxPendingSnapshotCount === 0, '重置诊断后最大值必须从当前 pending 重新开始')
}

export async function testPersistenceControllerKeepsFailedSnapshotPendingForRetry(): Promise<void> {
  const clock = createFakeClock()
  let status = 'idle' as 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  let attempt = 0
  const saved: string[] = []
  const controller = new PersistenceController({
    async saveSnapshot(value) {
      attempt += 1
      saved.push(value.profile?.displayName ?? '')
      if (attempt === 1) throw new Error('disk full')
    },
    captureSnapshot: () => ({
      snapshot: snapshot('latest'),
      stateReference: null,
      shortcutReference: null,
    }),
    status: {
      getStatus: () => status,
      setDirty: () => { status = 'dirty' },
      setSaving: () => { status = 'saving' },
      setSaved: () => { status = 'saved' },
      setError: () => { status = 'error' },
      reset: () => { status = 'idle' },
    },
    clock,
  })

  controller.enableWrites()
  controller.schedule(snapshot('failed'))
  let failed = false
  try {
    await controller.flushNow()
  } catch {
    failed = true
  }
  assert(failed && status === 'error', '首次写盘失败必须传播错误并保留 error 状态')
  assert(controller.hasPendingChanges(), '失败快照必须保持 pending 以供重试')

  await controller.flushNow()
  assert(saved.join(',') === 'latest,latest', '显式重试必须重新捕获并保存最新状态')
  assert(
    controller.hasPendingChanges() === false && String(status) === 'saved',
    '重试成功后才能进入 saved',
  )
}

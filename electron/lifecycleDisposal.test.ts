import {
  disposeOwnedLifecycle,
  initializeOwnedResource,
  LifecycleDisposalError,
  ResourceInitializationError,
} from './lifecycleDisposal'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

export async function testPresenceFailureLeavesHotkeyUntouchedAndCreatesNoReplacement(): Promise<void> {
  const calls: string[] = []
  try {
    await disposeOwnedLifecycle({
      disposePresence: () => { calls.push('presence:dispose'); throw new Error('tray failed') },
      disposeHotkey: async () => { calls.push('hotkey:dispose') },
      recoverPresence: () => { calls.push('presence:recover') },
    })
  } catch { /* expected */ }
  assert(calls.join('|') === 'presence:dispose', 'tray 释放失败时不得触碰 hotkey 或创建第二 tray')
}

export async function testHotkeyFailureRebuildsOnlyDisposedPresence(): Promise<void> {
  const calls: string[] = []
  try {
    await disposeOwnedLifecycle({
      disposePresence: () => { calls.push('presence:dispose') },
      disposeHotkey: async () => { calls.push('hotkey:dispose'); throw new Error('hotkey failed') },
      recoverPresence: () => { calls.push('presence:recover') },
    })
  } catch { /* expected */ }
  assert(
    calls.join('|') === 'presence:dispose|hotkey:dispose|presence:recover',
    'hotkey 释放失败时只能补偿已释放 presence，并保留原 hotkey 所有权',
  )
}

export async function testCompensationFailurePreservesBothErrorsAndOwnership(): Promise<void> {
  let failure: unknown
  try {
    await disposeOwnedLifecycle({
      disposePresence: () => {},
      disposeHotkey: async () => { throw new Error('hotkey failed') },
      recoverPresence: () => { throw new Error('presence recovery failed') },
    })
  } catch (error) { failure = error }
  assert(failure instanceof LifecycleDisposalError, '补偿失败必须返回可识别的生命周期聚合错误')
  assert(failure.errors.length === 2, '聚合错误必须同时保留 hotkey 与 presence 补偿异常')
  assert(!failure.ownership.presence && failure.ownership.hotkey, '所有权必须明确为 presence 已丢失、hotkey 仍保留')
}

export async function testRetryCompletesFullDisposalAfterHotkeyFailure(): Promise<void> {
  const calls: string[] = []
  let hotkeyAttempts = 0
  const dependencies = {
    disposePresence: () => { calls.push('presence:dispose') },
    disposeHotkey: async () => {
      calls.push('hotkey:dispose')
      hotkeyAttempts += 1
      if (hotkeyAttempts === 1) throw new Error('hotkey failed')
    },
    recoverPresence: () => { calls.push('presence:recover') },
  }
  try { await disposeOwnedLifecycle(dependencies) } catch { /* retry below */ }
  const ownership = await disposeOwnedLifecycle(dependencies)
  assert(
    calls.join('|') === 'presence:dispose|hotkey:dispose|presence:recover|presence:dispose|hotkey:dispose',
    '补偿成功后第二轮必须完整地重新释放 presence 与原 hotkey',
  )
  assert(!ownership.presence && !ownership.hotkey, '完整重试成功后不得残留服务所有权')
}

export function testFailedPresenceInitializationCleansCandidateBeforePublishing(): void {
  const calls: string[] = []
  let published: { dispose(): void } | null = null
  try {
    published = initializeOwnedResource({
      create: () => ({ dispose: () => { calls.push('tray:destroy') } }),
      initialize: () => { calls.push('tray:create', 'window:attach'); throw new Error('attach failed') },
      dispose: (candidate) => candidate.dispose(),
    })
  } catch { /* expected */ }
  assert(published === null, 'initialize 与 attach 全部成功前不得发布全局 presence')
  assert(calls.join('|') === 'tray:create|window:attach|tray:destroy', 'attach 失败必须销毁已取得的 tray 且不得重复创建')
}

export async function testFailedPresenceCleanupRetainsCandidateOwnership(): Promise<void> {
  const candidate = { dispose: () => { throw new Error('tray cleanup failed') } }
  let initializationFailure: unknown
  try {
    initializeOwnedResource({
      create: () => candidate,
      initialize: () => { throw new Error('attach failed') },
      dispose: (resource) => resource.dispose(),
    })
  } catch (error) { initializationFailure = error }
  assert(initializationFailure instanceof ResourceInitializationError, '初始化与清理双失败必须返回聚合错误')
  assert(initializationFailure.errors.length === 2, '初始化错误必须同时保留 attach 与 cleanup 异常')
  assert(initializationFailure.resource === candidate && initializationFailure.ownershipRetained, '清理失败必须保留可再次释放的候选引用')

  let disposalFailure: unknown
  try {
    await disposeOwnedLifecycle({
      disposePresence: () => {},
      disposeHotkey: async () => { throw new Error('hotkey failed') },
      recoverPresence: () => { throw initializationFailure },
    })
  } catch (error) { disposalFailure = error }
  assert(disposalFailure instanceof LifecycleDisposalError, '补偿初始化失败必须进入生命周期聚合错误')
  assert(disposalFailure.ownership.presence && disposalFailure.ownership.hotkey, 'candidate 清理失败时必须准确声明两项所有权仍被保留')
}

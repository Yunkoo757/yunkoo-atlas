import { disposeOwnedLifecycle, LifecycleDisposalError } from './lifecycleDisposal'

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

import { disposeOwnedLifecycle } from './lifecycleDisposal'

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message) }

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

import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { notifyStorageRecoveryRequired } from './lib/storageRecovery'
import { bootstrapStorage, isStorageHydrated } from './storage/bootstrap'
import { createEmptyPersistedSnapshot } from './storage/emptySnapshot'
import { flushPersistNow } from './storage/persist'
import { useStore } from './store/useStore'
import type { JournalBridge } from './types/journalBridge'

declare global {
  interface Window { __appBootstrapInterruptionTest?: Promise<void> }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function run() {
  let beginRead!: () => void
  const reading = new Promise<void>(resolve => { beginRead = resolve })
  let finishRead!: () => void
  const waitForDisk = new Promise<void>(resolve => { finishRead = resolve })
  let writes = 0
  const bridge = {
    isElectron: true, platform: 'darwin',
    getLibraryStatus: async () => ({ kind: 'ready', resolvedPath: '/isolated', configuredPath: '/isolated', source: 'config' } as const),
    storageOpen: async () => true,
    loadSnapshot: async () => {
      beginRead()
      await waitForDisk
      return { ...createEmptyPersistedSnapshot(), tagPresets: ['interrupted-snapshot'] }
    },
    saveSnapshot: async () => { writes++; return true },
  } satisfies Partial<JournalBridge>
  const original = window.journalBridge
  const root = createRoot(document.getElementById('root')!)
  try {
    Object.defineProperty(window, 'journalBridge', { configurable: true, value: bridge })
    root.render(<App />)
    await reading
    const opening = bootstrapStorage()
    notifyStorageRecoveryRequired('隔离资料库读取期间要求重新打开')
    finishRead()
    const result = await opening.then(() => 'opened', () => 'interrupted')
    await new Promise(requestAnimationFrame)
    assert(document.body.textContent?.includes('隔离资料库读取期间要求重新打开') &&
      document.body.textContent?.includes('重新打开资料库') && !document.querySelector('.sb-primary'),
      '迟到的启动结果不得覆盖原始恢复原因或进入工作区')
    const tags = useStore.getState().tagPresets
    useStore.setState({ tagPresets: ['after-recovery-lock'] })
    await flushPersistNow()
    assert(result === 'interrupted' && !isStorageHydrated() && !tags.includes('interrupted-snapshot') && writes === 0,
      `迟到快照必须放弃水合和保存。实际 result=${result} hydrated=${isStorageHydrated()} tags=${tags} writes=${writes}`)
  } finally {
    finishRead()
    root.unmount()
    Object.defineProperty(window, 'journalBridge', { configurable: true, value: original })
  }
}

window.__appBootstrapInterruptionTest = run()

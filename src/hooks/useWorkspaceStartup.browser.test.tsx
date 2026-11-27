import React from 'react'
import { createRoot } from 'react-dom/client'
import { useWorkspaceStartup } from './useWorkspaceStartup'
import { createNewLibrarySnapshot } from '@/storage/emptySnapshot'
import { useStore } from '@/store/useStore'
import { performanceTruthFixture } from '@/test/fixtures/performanceTruthFixture'
import type { JournalBridge, LibraryLocationState } from '@/types/journalBridge'

declare global {
  interface Window { __workspaceStartupTest?: Promise<void> }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function until(check: () => boolean) {
  const deadline = performance.now() + 4000
  while (!check() && performance.now() < deadline) await new Promise(requestAnimationFrame)
  assert(check(), '启动状态未按期完成')
}

async function verify(entry: 'initial' | 'selected' | 'retry') {
  const ready: LibraryLocationState = { kind: 'ready', configuredPath: '/fixture', resolvedPath: '/fixture', source: 'config' }
  const host = document.getElementById('root')!
  const root = createRoot(host)
  const originalBridge = window.journalBridge
  const fontProperty = Object.getOwnPropertyDescriptor(document.fonts, 'ready')
  const oldStore = useStore.getState()
  const events: string[] = []
  let status: LibraryLocationState = entry === 'initial' ? ready : entry === 'selected' ? { kind: 'unset' }
    : { kind: 'unavailable', configuredPath: '/missing', reason: '待重试' }
  let releaseFonts!: () => void
  const fonts = new Promise<void>(resolve => { releaseFonts = resolve })
  const snapshot = createNewLibrarySnapshot()
  const expired = {
    ...performanceTruthFixture.trades[0], tradeKind: 'live' as const, liveStageId: null,
    strategyId: snapshot.strategies[0].id, deletedAt: '2000-01-01T00:00:00.000Z',
  }
  const bridge = {
    isElectron: true,
    getLibraryStatus: async () => { events.push('status'); return status },
    openExistingLibrary: async () => ({ ok: true, snapshot: null } as const),
    storageOpen: async () => true,
    loadSnapshot: async () => ({ ...snapshot, trades: [expired] }),
    saveSnapshot: async () => true,
  } satisfies Partial<JournalBridge>
  const stage = async () => { events.push('stage') }
  function Screen() {
    const startup = useWorkspaceStartup(stage)
    return <button data-kind={startup.screen.kind} onClick={() =>
      void (startup.screen.kind === 'welcome' ? startup.activateSelection('open', '/fixture') : startup.retry())}>{startup.screen.kind}</button>
  }
  const kind = () => host.querySelector('button')?.dataset.kind
  try {
    Object.defineProperty(window, 'journalBridge', { configurable: true, value: bridge })
    Object.defineProperty(document.fonts, 'ready', { configurable: true, get() { return fonts } })
    useStore.setState({
      trades: [expired],
      purgeTrades: targets => {
        assert(targets.length === 1 && targets[0] === expired.id, '启动清理必须检查隔离样例的过期记录')
        events.push('clean')
        return { purgedIds: [], blockedIds: [], staleIds: [], notInTrashIds: [] }
      },
    })
    root.render(<Screen />)
    if (entry !== 'initial') {
      await until(() => kind() === (entry === 'selected' ? 'welcome' : 'error'))
      assert(events.join() === 'status', '资料库尚未就绪时不得执行启动任务')
      status = ready
      host.querySelector('button')!.click()
    }
    await until(() => events.includes('clean'))
    assert(kind() === 'loading', '字体就绪前不能发布可用工作区')
    const before = performance.now()
    if (entry !== 'retry') releaseFonts()
    await until(() => kind() === 'ready' && document.documentElement.dataset.uiSettled === '1')
    assert(events.join() === (entry === 'retry' ? 'status,status,stage,clean' : 'status,stage,clean'),
      '选库、初始化与重试必须按顺序执行同一份开库后任务')
    if (entry === 'retry') assert(performance.now() - before >= 950, '未收到字体回执应等待限定时间再进入')
  } finally {
    releaseFonts()
    root.unmount()
    useStore.setState(oldStore)
    if (fontProperty) Object.defineProperty(document.fonts, 'ready', fontProperty)
    else Reflect.deleteProperty(document.fonts, 'ready')
    Object.defineProperty(window, 'journalBridge', { configurable: true, value: originalBridge })
  }
}

window.__workspaceStartupTest = (async () => {
  await verify('selected')
  await verify('initial')
  await verify('retry')
})()

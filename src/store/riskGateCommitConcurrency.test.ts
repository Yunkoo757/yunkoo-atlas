import assert from 'node:assert/strict'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { disablePersistWrites, enablePersistWrites, flushPersistNow, getPersistenceDiagnostics } from '@/storage/persist'
import { snapshotToRuntimeState } from '@/storage/snapshotToRuntimeState'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import type { PersistedSnapshot } from '@/storage/types'
import { captureStoreForPersistence } from './persistedRevision'
import { useSaveStatus } from './saveStatus'
import { useStore } from './useStore'

/** 使用实际 Store、快捷键投影与自动保存。桌面适配器只读写测试内存中的独立快照。 */
async function withPendingOpen(run: (library: {
  disk(): PersistedSnapshot
  targetId: string
  writeCount(): number
  duringCommit(edit: () => void | Promise<void>): void
  failAutosave(fail: boolean): void
}) => Promise<void>) {
  const previous = useStore.getState()
  const previousSave = useSaveStatus.getState()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const seed = createFullPersistedSnapshotFixture()
  const target = { ...seed.trades[0]!, status: 'planned' as const, closedAt: null, activities: [] }
  delete target.closedTradingDayKey
  Object.assign(seed, { trades: [target], riskPolicyVersions: [], monthlyRiskLimits: [], weeklyRiskPreparations: [], weeklyReviews: [], riskOverrideEvents: [] })
  let disk = seed
  let writes = 0
  let edit: (() => void | Promise<void>) | undefined
  let fail = false
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { journalBridge: {
    isElectron: true,
    async commitImport(snapshot: PersistedSnapshot) {
      writes++
      disk = structuredClone(snapshot)
      await edit?.()
    },
    async saveSnapshot(snapshot: PersistedSnapshot) {
      if (fail) throw new Error('injected trailing save failure')
      disk = structuredClone(snapshot)
    },
  } } })
  try {
    useStore.setState(snapshotToRuntimeState(seed))
    enablePersistWrites(captureStoreForPersistence)
    assert.equal(useStore.getState().requestTradeOpen(target.id), 'pending-confirmation')
    await run({
      disk: () => disk, targetId: target.id, writeCount: () => writes,
      duringCommit: callback => { edit = callback }, failAutosave: value => { fail = value },
    })
  } finally {
    disablePersistWrites()
    useStore.setState(previous, true)
    useSaveStatus.setState(previousSave, true)
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testConfirmedOpenPreservesConcurrentJournalAndSelection() {
  await withPendingOpen(async library => {
    library.duringCommit(() => useStore.setState(current => ({
      selectedId: 'current-selection',
      profile: { ...current.profile, displayName: '并发编辑' },
      trades: current.trades.map(t => ({ ...t, note: '<p>确认期间的笔记</p>' })),
    })))
    assert.equal((await useStore.getState().confirmTradeOpen('并发确认')).kind, 'committed')
    const state = useStore.getState(), snapshot = library.disk()
    assert.equal(state.selectedId, 'current-selection')
    assert.equal(state.profile.displayName, '并发编辑')
    assert.equal(snapshot.profile?.displayName, '并发编辑')
    assertValidPersistedSnapshot(snapshot)
    assert.deepEqual(state.trades, snapshot.trades)
    assert.equal(snapshot.trades[0]?.status, 'open')
    assert.equal(snapshot.trades[0]?.note, '<p>确认期间的笔记</p>')
    assert.equal(snapshot.trades[0]?.activities?.filter(a => a.status === 'open').length, 1)
    assert.equal(snapshot.riskOverrideEvents.length, 1)
    assert.equal(library.writeCount(), 1)
  })
}

export async function testConfirmedOpenKeepsSubsequentStatusHistoryOnSameTrade() {
  await withPendingOpen(async library => {
    library.duringCommit(() => { useStore.getState().setStatus(library.targetId, 'missed') })
    assert.equal((await useStore.getState().confirmTradeOpen('同一交易并发状态')).kind, 'committed')
    const snapshot = library.disk()
    assertValidPersistedSnapshot(snapshot)
    assert.equal(snapshot.trades[0]?.status, 'missed')
    assert.deepEqual(snapshot.trades[0]?.activities?.map(a => a.status), ['open', 'missed'])
    assert.equal(snapshot.riskOverrideEvents.length, 1)
  })
}

export async function testPostCommitSaveFailureRetriesOnlyTheConcurrentEdits() {
  await withPendingOpen(async library => {
    library.duringCommit(() => {
      useStore.setState({ tagPresets: ['未落盘的标签'] })
      library.failAutosave(true)
    })
    const outcome = await useStore.getState().confirmTradeOpen('尾随写入失败')
    assert.deepEqual(outcome, { kind: 'committed', trailingSaveFailed: true })
    assert.equal(library.disk().riskOverrideEvents.length, 1)
    assert.equal(useStore.getState().pendingTradeOpenRequest, null)
    assert.equal(useSaveStatus.getState().status, 'error')
    assert.equal(getPersistenceDiagnostics().pendingSnapshotCount, 1)
    library.failAutosave(false)
    await flushPersistNow()
    assert.deepEqual(library.disk().tagPresets, ['未落盘的标签'])
    assert.equal(library.disk().riskOverrideEvents.length, 1)
    assert.equal(library.writeCount(), 1)
  })
}

export async function testCommittedOpenCannotRecreateAPurgedTradeOrPopulateAnotherLibrary() {
  await withPendingOpen(async library => {
    library.duringCommit(() => useStore.setState({ trades: [] }))
    assert.equal((await useStore.getState().confirmTradeOpen('来源已删除')).kind, 'committed')
    const snapshot = library.disk()
    assertValidPersistedSnapshot(snapshot)
    assert.equal(snapshot.trades.length, 0)
    assert.equal(snapshot.riskOverrideEvents[0]?.tradeId, library.targetId)
  })
  await withPendingOpen(async library => {
    library.duringCommit(() => useStore.setState(state => ({
      librarySession: state.librarySession + 1, trades: [], riskOverrideEvents: [], pendingTradeOpenRequest: null,
    })))
    assert.equal((await useStore.getState().confirmTradeOpen('原资料库确认')).kind, 'committed')
    assert.equal(library.disk().riskOverrideEvents.length, 1)
    assert.deepEqual(useStore.getState().riskOverrideEvents, [])
    assert.deepEqual(useStore.getState().trades, [])
  })
}

export async function testDuplicateConfirmationSharesOneDurableOpen() {
  await withPendingOpen(async library => {
    const confirm = useStore.getState().confirmTradeOpen
    let started!: () => void, release!: () => void
    const writing = new Promise<void>(resolve => { started = resolve })
    const allowed = new Promise<void>(resolve => { release = resolve })
    library.duringCommit(async () => { started(); await allowed })
    const first = confirm('首次确认')
    await writing
    const second = confirm('重复触发')
    await new Promise(resolve => setTimeout(resolve, 0))
    release()
    const results = await Promise.all([first, second])
    assert.deepEqual(results, [{ kind: 'committed' }, { kind: 'committed' }])
    assert.equal(library.writeCount(), 1)
    assert.equal(library.disk().riskOverrideEvents.length, 1)
    assert.equal(library.disk().riskOverrideEvents[0]?.reason, '首次确认')
  })
}

export async function testOldRiskReloadCannotPublishIntoReplacementSession() {
  await withPendingOpen(async library => {
    let started!: () => void, release!: () => void
    const reading = new Promise<void>(resolve => { started = resolve })
    const allowed = new Promise<void>(resolve => { release = resolve })
    const original = library.disk()
    window.journalBridge!.loadSnapshot = async () => {
      started()
      await allowed
      return original
    }
    const reloading = useStore.getState().rehydrateRiskGateFromStorage()
    await reading
    useStore.setState(s => ({ librarySession: s.librarySession + 1, trades: [] }))
    release()
    await reloading
    assert.deepEqual(useStore.getState().trades, [])
  })
}

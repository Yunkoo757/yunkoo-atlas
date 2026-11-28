import assert from 'node:assert/strict'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { disablePersistWrites, enablePersistWrites } from '@/storage/persist'
import { snapshotToRuntimeState } from '@/storage/snapshotToRuntimeState'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import type { PersistedSnapshot } from '@/storage/types'
import { captureStoreForPersistence } from '@/store/persistedRevision'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'

/** 使用实际 Store、快捷键投影与自动保存。桌面适配器只读写测试内存中的独立快照。 */
export async function withPendingOpen(run: (library: {
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
      assertValidPersistedSnapshot(snapshot, '风险确认测试资料库')
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

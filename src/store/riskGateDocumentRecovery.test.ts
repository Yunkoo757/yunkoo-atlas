import assert from 'node:assert/strict'
import { isStorageCutoverInteractionLocked } from '@/storage/cutover'
import { stopStorageForRecovery } from '@/storage/persist'
import { withPendingOpen } from '@/test/fixtures/pendingRiskOpen'
import { useStore } from './useStore'

export async function testRecoveryRevokesInflightRiskConfirmationAndRiskReload() {
  await withPendingOpen(async library => {
    const { confirmTradeOpen, rehydrateRiskGateFromStorage } = useStore.getState()
    const original = useStore.getState()
    let readFinished!: () => void
    const reloaded = new Promise<void>(resolve => { readFinished = resolve })
    let release!: () => void
    const receipt = new Promise<void>(resolve => { release = resolve })
    window.journalBridge!.loadSnapshot = async () => {
      stopStorageForRecovery('隔离测试 · 风险确认回执未返回')
      return library.disk()
    }
    library.duringCommit(async () => {
      await rehydrateRiskGateFromStorage()
      readFinished()
      await receipt
    })
    const pending = confirmTradeOpen('隔离中断')
    try {
      // 两个调用都已发起；磁盘含开仓，旧界面仍须显示原始状态。
      await Promise.race([reloaded, pending.then(() => { throw new Error('未到达开仓读回边界') })])
      assert.equal(isStorageCutoverInteractionLocked(), false)
      assert.equal(useStore.getState().trades, original.trades)
      release()
      assert.deepEqual(await pending, { kind: 'committed' })
      assert.equal(useStore.getState().trades, original.trades)
      assert.equal(useStore.getState().riskOverrideEvents, original.riskOverrideEvents)
      assert.equal(useStore.getState().pendingTradeOpenRequest, original.pendingTradeOpenRequest)
      assert.equal(library.disk().riskOverrideEvents.length, 1)
      assert.equal(library.disk().trades[0]?.status, 'open')
      assert.equal(library.writeCount(), 1)
    } finally {
      release()
      await pending
    }
  })
}

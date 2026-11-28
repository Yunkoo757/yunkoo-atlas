import assert from 'node:assert/strict'
import { DurableStorePublishError } from '@/lib/committedPublish'
import { commitComposerTradeBatch } from '@/lib/tradeComposerCommit'
import { isStorageCutoverInteractionLocked } from '@/storage/cutover'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { getPersistSuspendDepth, stopStorageForRecovery } from '@/storage/persist'
import { getStorage } from '@/storage/provider'
import type { PersistedSnapshot } from '@/storage/types'
import { useStore } from '@/store/useStore'

/** 文档撤销是终态，独立运行此回归以保留真实生命周期。 */
export async function testRetiredDocumentCannotPublishOrRetryADurableComposerBatch() {
  const seed = createFullPersistedSnapshotFixture()
  const previous = useStore.getState()
  const storage = getStorage(), originalCommit = storage.commitImport
  let start!: () => void, release!: () => void
  const written = new Promise<void>(resolve => { start = resolve })
  const reply = new Promise<void>(resolve => { release = resolve })
  const disk: PersistedSnapshot[] = []
  const id = 'isolated-durable-edit'
  storage.commitImport = async snapshot => {
    disk.push(structuredClone(snapshot))
    start()
    await reply
  }
  try {
    useStore.setState(seed)
    const save = () => commitComposerTradeBatch({
      storage, images: [], targetTradeId: id,
      buildTrade: () => ({ ...seed.trades[0]!, id, ref: 'TRD-ISOLATED' }),
    })
    const pending = save()
    await Promise.race([written, pending.then(() => { throw new Error('未到达资料库写入') })])
    stopStorageForRecovery('隔离测试文档已撤销')
    const locked = isStorageCutoverInteractionLocked()
    release()
    const error = await pending.then(() => undefined, cause => cause)
    const retry = await save().then(() => undefined, cause => cause)
    assert.equal(locked, false, '恢复界面不得等待尚未返回的写盘回执')
    assert.ok(error instanceof DurableStorePublishError, '磁盘已经提交，调用方应保留耐久写入状态')
    assert.ok(retry instanceof Error)
    assert.equal(disk.length, 1)
    assert.ok(disk[0]!.trades.some(trade => trade.id === id))
    assert.ok(!useStore.getState().trades.some(trade => trade.id === id))
    assert.equal(getPersistSuspendDepth(), 0)
  } finally {
    release()
    storage.commitImport = originalCommit
    useStore.setState(previous, true)
  }
}

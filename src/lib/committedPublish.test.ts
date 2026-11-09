import assert from 'node:assert/strict'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage/provider'
import { disablePersistWrites, enablePersistWrites, getPersistSuspendDepth, setPreFlushCallback } from '@/storage/persist'
import { commitComposerTradeBatch } from '@/lib/tradeComposerCommit'
import { commitNotionImportBatch } from '@/lib/notionImportCommit'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import type { NotionTradePreview } from '@/lib/notionImport'

async function publicationFailure(kind: 'notion' | 'composer' | 'composer-compensation') {
  const originalState = useStore.getState(), originalSet = useStore.setState
  const adapter = getStorage(), originalCommit = adapter.commitImport, originalSave = adapter.saveSnapshot
  const seed = createFullPersistedSnapshotFixture()
  let committed = false, commits = 0, overwrites = 0
  disablePersistWrites()
  setPreFlushCallback(null)
  originalSet({ ...seed })
  adapter.saveSnapshot = async () => { if (committed) overwrites++ }
  adapter.commitImport = async () => {
    commits++
    if (kind === 'composer-compensation') {
      if (commits === 2) throw new Error('isolated compensation failure')
      originalSet({ trades: seed.trades.map(trade => ({ ...trade, note: '<p>concurrent edit</p>' })) })
    }
    committed = true
  }
  enablePersistWrites()
  const originalError = console.error
  console.error = () => {}
  try {
    // 模拟磁盘提交成功后、Store 发布前失败；不操作真实资料库。
    useStore.setState = (() => { throw new Error('isolated publish failure') }) as typeof originalSet
    const operation = kind !== 'notion'
      ? commitComposerTradeBatch({ images: [], targetTradeId: kind === 'composer' ? 'isolated-created' : seed.trades[0]!.id, storage: adapter,
          buildTrade: () => ({ ...seed.trades[0]!, id: kind === 'composer' ? 'isolated-created' : seed.trades[0]!.id, ref: 'TRD-ISOLATED' }) })
      : commitNotionImportBatch([{
          rowIndex: 1, trade: { symbol: 'BTCUSDT', side: 'long', status: 'planned', conviction: 'medium', openedAt: '2026-11-10', strategyId: seed.strategies[0]!.id, tags: [], mistakeTags: [] },
          noteHtml: '<p>isolated import</p>', images: [], imageCount: 0, errors: [], warnings: [], collectedTags: [], mistakeTags: [],
        } as NotionTradePreview], { storage: adapter })
    let error: unknown
    try { await operation } catch (caught) { error = caught }
    assert.equal(commits, kind === 'composer-compensation' ? 2 : 1)
    assert.equal(overwrites, 0, '界面发布失败不能把旧 Store 再保存到已提交的资料库')
    assert.equal((error as { durablyCommitted?: boolean })?.durablyCommitted, true, '错误应明确数据已经写入，阻止按未提交重试')
    assert.equal((error as { requiresStorageReload?: boolean })?.requiresStorageReload, true)
    assert.equal(getPersistSuspendDepth(), 0)
  } finally {
    disablePersistWrites()
    console.error = originalError
    useStore.setState = originalSet
    adapter.commitImport = originalCommit
    adapter.saveSnapshot = originalSave
    originalSet(originalState)
  }
}

export async function testNotionPublishFailureNeverOverwritesItsCommittedImport() { await publicationFailure('notion') }
export async function testComposerPublishFailureNeverOverwritesItsCommittedTrade() { await publicationFailure('composer') }

export async function testFailedCompensationCannotEraseTheFirstDurableCommit() { await publicationFailure('composer-compensation') }

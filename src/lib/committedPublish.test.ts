import { captureStoreForPersistence } from '@/store/persistedRevision'
import type { PersistencePause } from '@/storage/persistenceController'
import assert from 'node:assert/strict'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage/provider'
import { isStorageCutoverInteractionLocked } from '@/storage/cutover'
import { disablePersistWrites, enablePersistWrites, getPersistSuspendDepth, schedulePersist, setPreFlushCallback, suspendPersist } from '@/storage/persist'
import { commitComposerTradeBatch } from '@/lib/tradeComposerCommit'
import { applyImport } from '@/lib/importExport'
import { SCHEMA_VERSION } from '@/storage/types'
import { commitNotionImportBatch } from '@/lib/notionImportCommit'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import type { NotionTradePreview } from '@/lib/notionImport'

async function publicationFailure(kind: 'notion' | 'composer' | 'composer-compensation' | 'json' | 'json-compensation', failStatusReset = false) {
  const originalStatus = useSaveStatus.getState()
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
    if (kind.endsWith('-compensation')) {
      if (commits === 2) throw new Error('isolated compensation failure')
      originalSet({ trades: seed.trades.map(trade => ({ ...trade, note: '<p>concurrent edit</p>' })) })
    }
    committed = true
    if (failStatusReset) useSaveStatus.setState({ reset: () => { throw new Error('status listener failed') } })
  }
  enablePersistWrites(captureStoreForPersistence)
  const originalError = console.error
  console.error = () => {}
  try {
    // 模拟磁盘提交成功后、Store 发布前失败；不操作真实资料库。
    useStore.setState = (() => { throw new Error('isolated publish failure') }) as typeof originalSet
    const run = () => {
      if (kind === 'json' || kind === 'json-compensation') {
        return applyImport({
          ...seed, version: SCHEMA_VERSION, weeklyReviews: [], quickNotes: [], riskOverrideEvents: [],
          trades: seed.trades.map(trade => ({ ...trade, note: '<p>导入正文</p>' })),
        })
      }
      if (kind === 'notion') {
        return commitNotionImportBatch([{
          rowIndex: 1, trade: { symbol: 'BTCUSDT', side: 'long', status: 'planned', conviction: 'medium', openedAt: '2026-11-10', strategyId: seed.strategies[0]!.id, tags: [], mistakeTags: [] },
          noteHtml: '<p>isolated import</p>', images: [], imageCount: 0, errors: [], warnings: [], collectedTags: [], mistakeTags: [],
        } as NotionTradePreview], { storage: adapter })
      }
      const id = kind === 'composer' ? 'isolated-created' : seed.trades[0]!.id
      return commitComposerTradeBatch({
        images: [], targetTradeId: id, storage: adapter,
        buildTrade: () => ({ ...seed.trades[0]!, id, ref: 'TRD-ISOLATED' }),
      })
    }
    let error: unknown
    try { await run() } catch (caught) { error = caught }
    assert.equal(commits, kind.endsWith('-compensation') ? 2 : 1, String(error))
    assert.equal(overwrites, 0, '界面发布失败不能把旧 Store 再保存到已提交的资料库')
    assert.equal((error as { durablyCommitted?: boolean })?.durablyCommitted, true, '错误应明确数据已经写入，阻止按未提交重试')
    assert.equal((error as { requiresStorageReload?: boolean })?.requiresStorageReload, true)
    assert.equal(getPersistSuspendDepth(), 0)
  } finally {
    disablePersistWrites()
    useSaveStatus.setState(originalStatus)
    console.error = originalError
    useStore.setState = originalSet
    adapter.commitImport = originalCommit
    adapter.saveSnapshot = originalSave
    originalSet(originalState)
  }
}

async function checkComposerSubscriberEdit(displayName: string, expectedTrailingSaves: number) {
  const seed = createFullPersistedSnapshotFixture()
  const previous = useStore.getState(), previousStatus = useSaveStatus.getState()
  const adapter = getStorage(), originalSave = adapter.saveSnapshot, originalCommit = adapter.commitImport
  let disk = seed
  let commits = 0
  let savesAfterCommit = 0
  useStore.setState(seed)
  adapter.saveSnapshot = async snapshot => {
    if (commits) savesAfterCommit++
    disk = structuredClone(snapshot)
  }
  adapter.commitImport = async snapshot => { commits++; disk = structuredClone(snapshot) }
  enablePersistWrites(captureStoreForPersistence)
  const id = 'composer-subscriber-edit'
  const unsubscribe = useStore.subscribe((state, prior) => {
    schedulePersist(captureStoreForPersistence().snapshot)
    if (state.trades !== prior.trades && state.trades.some(trade => trade.id === id)) {
      useStore.setState({ profile: { ...state.profile, displayName } })
    }
  })
  try {
    const result = await commitComposerTradeBatch({
      images: [], targetTradeId: id, storage: adapter,
      buildTrade: () => ({ ...seed.trades[0]!, id, ref: 'TRD-ISOLATED-EDIT' }),
    })
    assert.equal(result.trailingSaveFailed, false)
    assert.equal(commits, 1)
    assert.equal(disk.profile?.displayName, displayName)
    assert.equal(savesAfterCommit, expectedTrailingSaves)
    assert.ok(disk.trades.some(trade => trade.id === id))
  } finally {
    unsubscribe()
    disablePersistWrites()
    adapter.saveSnapshot = originalSave
    adapter.commitImport = originalCommit
    useStore.setState(previous, true)
    useSaveStatus.setState(previousStatus, true)
  }
}

export async function testComposerSavesEditsFromStoreSubscribersAfterItsDurableWrite() {
  await checkComposerSubscriberEdit('发布时编辑', 1)
}

export async function testComposerSkipsTrailingWriteWhenPublishedDataAreEquivalent() {
  await checkComposerSubscriberEdit(createFullPersistedSnapshotFixture().profile!.displayName, 0)
}

export async function testJsonPublishFailureNeverOverwritesItsCommittedImport() { await publicationFailure('json') }
export async function testJsonCompensationFailurePreservesDurableCandidateForRecovery() { await publicationFailure('json-compensation') }
export async function testNotionPublishFailureNeverOverwritesItsCommittedImport() { await publicationFailure('notion') }
export async function testComposerPublishFailureNeverOverwritesItsCommittedTrade() { await publicationFailure('composer') }

export async function testFailedCompensationCannotEraseTheFirstDurableCommit() { await publicationFailure('composer-compensation') }

export async function testSecondaryCleanupFailurePreservesDurableRecoveryError() { await publicationFailure('composer', true) }

export async function testFailedBatchPreflushCannotReleaseAnotherOperationsSuspension() {
  const adapter = getStorage()
  const initialDepth = getPersistSuspendDepth()
  let writes = 0
  const original = adapter.commitImport
  const failure = new Error('isolated preflush failure')
  adapter.commitImport = async () => { writes++ }
  enablePersistWrites(captureStoreForPersistence)
  const outerPause = suspendPersist()
  setPreFlushCallback(async () => { throw failure })
  try {
    for (const run of [
      () => commitNotionImportBatch([], { storage: adapter }),
      () => commitComposerTradeBatch({ images: [], targetTradeId: '', buildTrade: () => null, storage: adapter }),
    ]) {
      await assert.rejects(run(), error => error === failure)
      assert.equal(getPersistSuspendDepth(), initialDepth + 1, '只能释放本轮实际获取的暂停')
      assert.equal(isStorageCutoverInteractionLocked(), false)
    }
    assert.equal(writes, 0)
  } finally {
    disablePersistWrites()
    setPreFlushCallback(null)
    outerPause.resume({ flushNow: false })
    adapter.commitImport = original
  }
}

export async function testFailedTrailingSaveRetriesWithoutConsumingANewSuspension() {
  const adapter = getStorage()
  const originalState = useStore.getState()
  const originalSave = adapter.saveSnapshot
  const originalCommit = adapter.commitImport
  const seed = createFullPersistedSnapshotFixture()
  const originalDepth = getPersistSuspendDepth()
  let otherPause: PersistencePause | undefined
  try {
    for (const anotherOperationSuspends of [false, true]) {
      let committed = false
      let trailingAttempts = 0
      useStore.setState(seed)
      adapter.commitImport = async () => {
        committed = true
        useStore.setState({ tagPresets: [...useStore.getState().tagPresets, '并发修改'] })
      }
      adapter.saveSnapshot = async () => {
        if (!committed) return
        trailingAttempts++
        if (trailingAttempts === 1) {
          if (anotherOperationSuspends) otherPause = suspendPersist()
          throw new Error('isolated trailing save failed')
        }
      }
      enablePersistWrites(captureStoreForPersistence)
      const result = await commitComposerTradeBatch({
        images: [], targetTradeId: 'isolated-new', storage: adapter,
        buildTrade: () => ({ ...seed.trades[0]!, id: 'isolated-new', ref: 'TRD-ISOLATED-NEW' }),
      })
      assert.equal(result.trailingSaveFailed, true, '提交成功后须报告首次追写失败')
      assert.equal(trailingAttempts, anotherOperationSuspends ? 1 : 2)
      assert.equal(getPersistSuspendDepth(), originalDepth + Number(anotherOperationSuspends))
      assert.equal(isStorageCutoverInteractionLocked(), false)
      disablePersistWrites()
      otherPause?.resume({ flushNow: false })
    }
  } finally {
    disablePersistWrites()
    otherPause?.resume({ flushNow: false })
    adapter.saveSnapshot = originalSave
    adapter.commitImport = originalCommit
    useStore.setState(originalState)
  }
}

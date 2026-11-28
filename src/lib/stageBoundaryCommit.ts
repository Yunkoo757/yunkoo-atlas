import { commitSnapshotBatch } from '@/lib/committedPublish'
import { applyRecommendedStageBoundaryRepair, type RecommendedStageBoundaryRepair } from '@/lib/stageOwnershipRepair'
import { flushStorageBeforeCutover } from '@/storage/cutover'
import { getStorage } from '@/storage/provider'
import { pickPersisted } from '@/storage/snapshotProjection'
import { capturePersistedStateRevision, hasSamePersistedStateRevision } from '@/store/persistedRevision'
import { useStore } from '@/store/useStore'

/** 按预览修复阶段、交易和周复盘。草稿先落盘，候选通过耐久写入后才发布。 */
export async function saveRecommendedStageBoundaryRepair(recommendation: RecommendedStageBoundaryRepair): Promise<void> {
  const storage = getStorage()
  await commitSnapshotBatch({
    source: 'StageBoundaryRepair',
    beforeCommit: flushStorageBeforeCutover,
    persist: snapshot => storage.saveSnapshot(snapshot),
  }, async writer => {
    let revision = capturePersistedStateRevision()
    let candidate: ReturnType<typeof useStore.getState>
    try {
      for (;;) {
        candidate = applyRecommendedStageBoundaryRepair(revision.state, recommendation)
        await writer.commit(pickPersisted(candidate, revision.shortcutBindings))
        const latest = capturePersistedStateRevision()
        if (hasSamePersistedStateRevision(revision, latest)) break
        revision = latest
      }
    } catch (error) {
      if (writer.diskAhead) {
        const latest = capturePersistedStateRevision()
        await writer.compensate(pickPersisted(latest.state, latest.shortcutBindings))
      }
      throw error
    }

    writer.publish(() => useStore.setState({ liveStages: candidate.liveStages, trades: candidate.trades, weeklyReviews: candidate.weeklyReviews }))
    return { result: {} }
  })
}

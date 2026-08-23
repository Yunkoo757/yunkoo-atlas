import { assertValidPersistedSnapshot } from '../src/storage/snapshotValidation'
import { createElectronQaSeedSnapshot } from './qaSeed'

export function testElectronQaSeedUsesItsRealCurrentStageOwnership(): void {
  const snapshot = createElectronQaSeedSnapshot()
  assertValidPersistedSnapshot(snapshot, 'Electron QA seed')
  const trade = snapshot.trades[0]
  if (trade?.tradeKind !== 'live' || trade.liveStageId !== snapshot.currentLiveStageId) {
    throw new Error('Electron QA live trade must belong to the seed snapshot current stage')
  }
}

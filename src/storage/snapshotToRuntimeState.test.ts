import { snapshotToRuntimeState } from './snapshotToRuntimeState'
import { createEmptyPersistedSnapshot } from './emptySnapshot'

export function testRuntimeProjectionIsPureAndPreservesIndependentRecords() {
  const snapshot = createEmptyPersistedSnapshot()
  const before = JSON.stringify(snapshot)
  const projected = snapshotToRuntimeState(snapshot)
  if (JSON.stringify(snapshot) !== before) throw Error('Runtime projection mutated source snapshot')
  if (projected.trades.length !== 0 || projected.currentLiveStageId !== snapshot.currentLiveStageId) throw Error('Runtime projection changed library ownership')
  if (projected.quickNotes.length || projected.backtestProjects.length) throw Error('Runtime projection fabricated records')
  if (projected.liveStages === snapshot.liveStages) throw Error('Mutable stage objects must be isolated')
}

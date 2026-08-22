import { assertValidPersistedSnapshot } from '../src/storage/snapshotValidation'
import { createForcedKillSnapshot } from './forcedKillQa'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testForcedKillSeedIsAValidSelfContainedNativeStageGraph(): void {
  for (const fixture of [
    createForcedKillSnapshot('confirmed-revision-1'),
    createForcedKillSnapshot('unconfirmed-revision-2', 1024),
  ]) {
    assertValidPersistedSnapshot(fixture)

    const currentStageId = fixture.currentLiveStageId
    const archivedStageIds = new Set(
      fixture.liveStages.filter((stage) => stage.status === 'archived').map((stage) => stage.id),
    )
    assert(currentStageId !== null, '强杀 fixture 必须拥有 current stage')
    assert(
      fixture.trades.some((trade) => trade.tradeKind !== 'paper' && trade.liveStageId === currentStageId),
      '必须覆盖 current trade',
    )
    assert(
      fixture.trades.some((trade) => (
        trade.tradeKind !== 'paper' &&
        typeof trade.liveStageId === 'string' &&
        archivedStageIds.has(trade.liveStageId)
      )),
      '必须覆盖 archived trade',
    )
    assert(
      fixture.weeklyReviews?.every((review) => review.liveStageId === currentStageId),
      '周复盘必须属于覆盖其完整周区间的 current stage',
    )
    assert(
      [
        ...fixture.weeklyRiskPreparations,
        ...fixture.riskPolicyVersions,
        ...fixture.monthlyRiskLimits,
        ...fixture.riskOverrideEvents,
      ].every((entity) => entity.liveStageId === currentStageId),
      '直接风险图必须与其 current trade 和周复盘同 stage',
    )
  }
}

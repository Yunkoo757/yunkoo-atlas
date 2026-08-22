import {
  assertValidLiveStageState,
  createInitialLiveStage,
  createNextLiveStage,
  getCurrentLiveStage,
} from '@/lib/liveStages'
import type { CaseTrade, LiveTrade, PaperTrade } from '@/data/trades'

type Assert<T extends true> = T
type HasKey<T, Key extends PropertyKey> = Key extends keyof T ? true : false

type LiveTradeKeepsCompatibleStageOwnership = Assert<
  LiveTrade['liveStageId'] extends string | null | undefined ? true : false
>
type CaseTradeKeepsCompatibleStageOwnership = Assert<
  CaseTrade['liveStageId'] extends string | null | undefined ? true : false
>
type PaperTradeRejectsStageOwnership = Assert<
  HasKey<PaperTrade, 'liveStageId'> extends false ? true : false
>

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

export function testLiveStageStateRequiresExactlyOneCurrentStage(): void {
  const first = createInitialLiveStage('2026-08-24', '2026-08-24T00:00:00.000Z', 'stage-1')
  assert(getCurrentLiveStage([first], first.id).id === first.id, 'initial stage must be current')
  let rejected = false
  try {
    assertValidLiveStageState({ liveStages: [{ ...first, status: 'archived', endsOn: '2026-08-23', archivedAt: first.createdAt }], currentLiveStageId: first.id })
  } catch { rejected = true }
  assert(rejected, 'archived currentLiveStageId must be rejected')
}

export function testNextStageArchivesPreviousWithoutChangingItsIdentity(): void {
  const first = createInitialLiveStage('2026-08-24', '2026-08-24T00:00:00.000Z', 'stage-1')
  const next = createNextLiveStage(first, '2026-08-31', '2026-08-31T00:00:00.000Z', 'stage-2')
  assert(next.archived.id === first.id, 'old stage identity must remain stable')
  assert(next.archived.endsOn === '2026-08-30', 'old stage must end before new Monday')
  assert(next.current.sequence === 2 && next.current.status === 'current', 'new stage must increment sequence')
}

export function testLiveStageCreationUsesCanonicalDatesAndDefaultNames(): void {
  const first = createInitialLiveStage('2026-01-01', '2026-01-01T00:00:00.000Z', 'stage-1')
  const next = createNextLiveStage(first, '2026-03-01', '2026-03-01T00:00:00.000Z', 'stage-2')
  assert(first.name === '实盘阶段 1' && first.endsOn === null && first.archivedAt === null, 'initial stage must have the canonical default current shape')
  assert(next.current.name === '实盘阶段 2', 'next stage must use its sequence in the default name')
  assert(next.archived.endsOn === '2026-02-28', 'previous-day calculation must preserve local calendar boundaries')
}

export function testLiveStageStateRejectsInvalidIdentityAndTimelineInvariants(): void {
  const first = createInitialLiveStage('2026-08-24', '2026-08-24T00:00:00.000Z', 'stage-1')
  const { archived, current } = createNextLiveStage(first, '2026-08-31', '2026-08-31T00:00:00.000Z', 'stage-2')
  const invalidStates = [
    { liveStages: [{ ...archived, startsOn: '2026-08-32' }, current], currentLiveStageId: current.id },
    { liveStages: [archived, { ...current, id: archived.id }], currentLiveStageId: current.id },
    { liveStages: [archived, { ...current, sequence: archived.sequence }], currentLiveStageId: current.id },
    { liveStages: [{ ...archived, endsOn: current.startsOn }, current], currentLiveStageId: current.id },
    { liveStages: [archived, { ...current, status: 'archived', endsOn: '2026-09-01', archivedAt: current.createdAt }], currentLiveStageId: current.id },
  ]
  for (const state of invalidStates) {
    let rejected = false
    try { assertValidLiveStageState(state) } catch { rejected = true }
    assert(rejected, 'invalid stage identity, date, overlap, or current-stage state must be rejected')
  }
}

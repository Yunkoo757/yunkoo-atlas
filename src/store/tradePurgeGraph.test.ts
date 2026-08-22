import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { pickPersisted } from '@/storage/persist'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import { useStore } from '@/store/useStore'
import type { WeeklyReview } from '@/data/weeklyReviews'
import { cleanExpiredTradeTrash } from '@/lib/trashCleanup'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function frozenEvidenceReview(): WeeklyReview {
  const fixture = createFullPersistedSnapshotFixture()
  const source = fixture.trades[0]!
  return {
    ...fixture.weeklyReviews![0]!,
    evidenceSnapshot: {
      trades: [{
        id: source.id,
        ref: source.ref,
        symbol: source.symbol,
        status: source.status,
        pnl: source.pnl ?? null,
        rMultiple: source.rMultiple ?? null,
        cashCurrency: source.cashCurrency ?? null,
      }],
      missedTrades: [],
      legacyCashCurrencyAssumption: null,
    },
  }
}

function installFixture(review: WeeklyReview): ReturnType<typeof useStore.getState> {
  const previous = useStore.getState()
  const fixture = createFullPersistedSnapshotFixture()
  useStore.setState({
    trades: fixture.trades,
    liveStages: fixture.liveStages,
    currentLiveStageId: fixture.currentLiveStageId,
    scheduledStageRollover: fixture.scheduledStageRollover,
    weeklyRiskPreparations: fixture.weeklyRiskPreparations,
    riskPolicyVersions: fixture.riskPolicyVersions,
    monthlyRiskLimits: fixture.monthlyRiskLimits,
    riskOverrideEvents: fixture.riskOverrideEvents,
    weeklyReviews: [review],
    starredIds: fixture.starredIds,
    subscribedIds: fixture.subscribedIds,
  })
  return previous
}

export function testPurgeKeepsSelfContainedFrozenEvidenceAndProducesAValidSnapshot(): void {
  const review = frozenEvidenceReview()
  const frozenBefore = structuredClone(review)
  const previous = installFixture(review)
  try {
    const tradeId = createFullPersistedSnapshotFixture().trades[0]!.id
    const result = useStore.getState().purgeTrades([tradeId])
    const state = useStore.getState()

    assert(result.purgedIds.join() === tradeId, '有自包含冻结证据的交易必须仍可彻底删除')
    assert(result.blockedIds.length === 0, '自包含冻结证据不得误报为删除阻塞')
    assert(!state.trades.some((trade) => trade.id === tradeId), '彻底删除必须移除来源交易')
    assert(
      JSON.stringify(state.weeklyReviews[0]) === JSON.stringify(frozenBefore),
      '完成态周复盘及其冻结证据不得因来源交易删除而被改写',
    )
    assertValidPersistedSnapshot(pickPersisted(state, {}), 'Purged frozen-evidence snapshot')
  } finally {
    useStore.setState(previous, true)
  }
}

export function testPurgeBlocksLegacyCompletedReviewWithoutSelfContainedEvidence(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const legacyReview = fixture.weeklyReviews![0]!
  const previous = installFixture(legacyReview)
  try {
    const tradeId = fixture.trades[0]!.id
    const result = useStore.getState().purgeTrades([tradeId])
    const state = useStore.getState()

    assert(result.purgedIds.length === 0, '缺少自包含证据的旧完成态周复盘必须阻止来源交易彻底删除')
    assert(result.blockedIds.join() === tradeId, '删除结果必须返回可操作的阻塞交易 ID')
    assert(state.trades.some((trade) => trade.id === tradeId), '被旧完成态周复盘引用的交易必须保留')
    assertValidPersistedSnapshot(pickPersisted(state, {}), 'Blocked legacy-review purge snapshot')
  } finally {
    useStore.setState(previous, true)
  }
}

export function testPurgeScrubsEditableDraftReviewReferencesBeforePersistence(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const draft: WeeklyReview = {
    ...fixture.weeklyReviews![0]!,
    status: 'draft',
    metricsSnapshot: null,
    evidenceSnapshot: undefined,
    riskSnapshot: undefined,
    completedAt: null,
  }
  const previous = installFixture(draft)
  try {
    const tradeId = fixture.trades[0]!.id
    const result = useStore.getState().purgeTrades([tradeId])
    const state = useStore.getState()

    assert(result.purgedIds.join() === tradeId, '草稿引用必须可随来源交易一起清理')
    assert(state.weeklyReviews[0]?.highlightTradeIds.length === 0, '草稿高亮引用必须随删除清理')
    assert(state.weeklyReviews[0]?.mistakeTradeIds.length === 0, '草稿错误引用必须随删除清理')
    assert(state.weeklyReviews[0]?.followUpTradeIds.length === 0, '草稿跟进引用必须随删除清理')
    assertValidPersistedSnapshot(pickPersisted(state, {}), 'Purged draft-reference snapshot')
  } finally {
    useStore.setState(previous, true)
  }
}

export async function testAutomaticTrashCleanupSkipsLegacyFrozenGraphBlockers(): Promise<void> {
  const fixture = createFullPersistedSnapshotFixture()
  const previous = installFixture(fixture.weeklyReviews![0]!)
  try {
    useStore.setState({
      trades: fixture.trades.map((trade) => ({
        ...trade,
        deletedAt: '2000-01-01T00:00:00.000Z',
      })),
    })
    const state = useStore.getState()
    const cleaned = await cleanExpiredTradeTrash(state.trades, state.purgeTrades)

    assert(cleaned === 0, '自动清理不得把因旧冻结图而保留的交易计为已删除')
    assert(useStore.getState().trades.length === 1, '自动清理必须跳过旧冻结图引用的交易')
    assertValidPersistedSnapshot(
      pickPersisted(useStore.getState(), {}),
      'Automatically skipped legacy-review purge snapshot',
    )
  } finally {
    useStore.setState(previous, true)
  }
}

export async function testManualAndAutomaticPurgeKeepEveryPendingOwnershipSource(): Promise<void> {
  const fixture = createFullPersistedSnapshotFixture()
  const base = fixture.trades[0]!
  const caseSource = { ...base, id: 'pending-case-source', ref: 'TRD-PENDING-CASE' }
  const overrideSource = { ...base, id: 'pending-override-source', ref: 'TRD-PENDING-OVERRIDE' }
  const reviewSource = { ...base, id: 'pending-review-source', ref: 'TRD-PENDING-REVIEW' }
  const pendingCase = {
    ...base,
    id: 'pending-case',
    ref: 'CASE-PENDING',
    tradeKind: 'case' as const,
    liveStageId: null,
    sourceTradeId: caseSource.id,
  }
  const evidenceReview: WeeklyReview = {
    ...frozenEvidenceReview(),
    liveStageId: null,
    legacyPeriodQuarantine: true,
    highlightTradeIds: [reviewSource.id],
    evidenceSnapshot: {
      trades: [{
        id: reviewSource.id,
        ref: reviewSource.ref,
        symbol: reviewSource.symbol,
        status: reviewSource.status,
        pnl: reviewSource.pnl ?? null,
        rMultiple: reviewSource.rMultiple ?? null,
        cashCurrency: reviewSource.cashCurrency ?? null,
      }],
      missedTrades: [],
      legacyCashCurrencyAssumption: null,
    },
  }
  const previous = installFixture(evidenceReview)
  try {
    const expiredSources = [caseSource, overrideSource, reviewSource].map((trade) => ({
      ...trade,
      deletedAt: '2000-01-01T00:00:00.000Z',
    }))
    useStore.setState({
      trades: [...expiredSources, pendingCase],
      riskOverrideEvents: fixture.riskOverrideEvents.map((event) => ({
        ...event,
        liveStageId: null,
        tradeId: overrideSource.id,
        tradeIdentityAtDecision: {
          ref: overrideSource.ref,
          symbol: overrideSource.symbol,
          tradeKind: 'live' as const,
        },
      })),
      weeklyReviews: [evidenceReview],
    })

    const targetIds = expiredSources.map((trade) => trade.id)
    const manual = useStore.getState().purgeTrades(targetIds)
    assert(manual.purgedIds.length === 0, '手动 purge 不得删除任何待归属图的来源交易')
    assert(
      [...manual.blockedIds].sort().join() === [...targetIds].sort().join(),
      '手动 purge 必须逐项报告 pending case、override 与 review 的来源阻塞',
    )

    const state = useStore.getState()
    const automatic = await cleanExpiredTradeTrash(state.trades, state.purgeTrades)
    assert(automatic === 0, '自动清理不得把任何待归属图来源计为已删除')
    assert(
      targetIds.every((id) => useStore.getState().trades.some((trade) => trade.id === id)),
      '自动清理必须保留全部待归属图来源，确保修复仍可完成',
    )
    assertValidPersistedSnapshot(
      pickPersisted(useStore.getState(), {}),
      'Pending ownership sources after purge attempts',
    )
  } finally {
    useStore.setState(previous, true)
  }
}

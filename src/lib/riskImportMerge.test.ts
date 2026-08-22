import type { Trade } from '@/data/trades'
import { canonicalImportValue } from '@/lib/importMerge'
import type { PersistedSlice } from '@/lib/importTypes'
import { mergeRiskImport, stableImportedTradeId } from '@/lib/riskImportMerge'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function identifiedTrade(id: string, ref: string, symbol: string, createId: string): Trade {
  return {
    id,
    ref,
    symbol,
    side: 'long',
    status: 'open',
    conviction: 'medium',
    strategyId: 'strategy-contract',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-14T09:00:00.000Z',
    closedAt: null,
    note: '',
    activities: [{
      id: createId,
      kind: 'create',
      timestamp: '2026-07-14T09:00:00.000Z',
    }],
  }
}

function localFixture(): PersistedSlice {
  return {
    ...createFullPersistedSnapshotFixture(),
    trades: [identifiedTrade('trade-1', 'LOCAL-1', 'EURUSD', 'create-local')],
    riskOverrideEvents: [],
    weeklyReviews: [],
    starredIds: [],
    subscribedIds: [],
  }
}

function importedCollisionFixture(): PersistedSlice {
  const fixture = createFullPersistedSnapshotFixture()
  const imported = identifiedTrade('trade-1', 'IMPORTED-1', 'BTCUSDT', 'create-imported')
  const sourceCase: Trade = {
    ...identifiedTrade('case-1', 'CASE-1', 'BTCUSDT', 'create-case'),
    tradeKind: 'case',
    sourceTradeId: imported.id,
  }
  const event = {
    ...fixture.riskOverrideEvents[0]!,
    id: 'override-imported',
    tradeId: imported.id,
    tradeIdentityAtDecision: { ref: imported.ref, symbol: imported.symbol, tradeKind: 'live' as const },
  }
  return {
    ...fixture,
    trades: [imported, sourceCase],
    riskOverrideEvents: [event],
    weeklyReviews: [{
      ...fixture.weeklyReviews![0]!,
      id: 'weekly-review:2026-07-20',
      weekStart: '2026-07-20',
      weekEnd: '2026-07-26',
      highlightTradeIds: [imported.id],
      mistakeTradeIds: [imported.id],
      followUpTradeIds: [imported.id],
      evidenceSnapshot: {
        legacyCashCurrencyAssumption: {
          currency: 'USD',
          confirmedAt: '2026-07-27T08:00:00.000Z',
        },
        trades: [{
          id: imported.id,
          ref: imported.ref,
          symbol: imported.symbol,
          status: imported.status,
          pnl: imported.pnl,
          rMultiple: imported.rMultiple,
        }],
        missedTrades: [{
          id: imported.id,
          ref: imported.ref,
          symbol: imported.symbol,
          status: imported.status,
          pnl: imported.pnl,
          rMultiple: imported.rMultiple,
        }],
      },
      riskSnapshot: {
        ...fixture.weeklyReviews![0]!.riskSnapshot!,
        overrideEvents: [event],
      },
    }],
    starredIds: [imported.id],
    subscribedIds: [imported.id],
  }
}

function uniqueTradeIds(snapshot: PersistedSlice): string[] {
  return [...new Set(snapshot.trades.map((trade) => trade.id))]
}

function completedReviewMergeFixtures(): { current: PersistedSlice; imported: PersistedSlice } {
  const current = createFullPersistedSnapshotFixture()
  const localReview = {
    ...current.weeklyReviews![0]!,
    id: 'weekly-review:shared-stage-week',
    contentHtml: '<p>本地内容</p>',
    updatedAt: '2026-07-19T08:00:00.000Z',
  }
  current.weeklyReviews = [localReview]
  const imported = createFullPersistedSnapshotFixture()
  imported.weeklyReviews = [{
    ...localReview,
    contentHtml: '<p>导入的新内容</p>',
    executionScore: 5,
    updatedAt: '2026-07-20T08:00:00.000Z',
  }]
  return { current, imported }
}

export function testCompletedReviewWithSameFrozenTupleMergesEditableContent(): void {
  const { current, imported } = completedReviewMergeFixtures()
  const local = current.weeklyReviews![0]!
  const merged = mergeRiskImport(current, imported, 'sha256-completed-same-freeze')
  const review = merged.weeklyReviews![0]!
  assert(review.contentHtml === '<p>导入的新内容</p>', '相同冻结元组必须允许合并较新的自由内容')
  assert(review.executionScore === 5, '相同冻结元组必须允许合并评分')
  assert(review.status === 'completed', '内容合并不得改变完成状态')
  assert(review.completedAt === local.completedAt, '内容合并不得改变完成时间')
  assert(canonicalImportValue(review.metricsSnapshot) === canonicalImportValue(local.metricsSnapshot), '内容合并不得改变指标快照')
  assert(canonicalImportValue(review.evidenceSnapshot) === canonicalImportValue(local.evidenceSnapshot), '内容合并不得改变证据快照')
  assert(canonicalImportValue(review.riskSnapshot) === canonicalImportValue(local.riskSnapshot), '内容合并不得改变风险快照')
}

export function testCompletedReviewWithDifferentFrozenTupleRejectsAtomically(): void {
  const { current, imported } = completedReviewMergeFixtures()
  imported.weeklyReviews = imported.weeklyReviews!.map((review) => ({
    ...review,
    completedAt: '2026-07-21T08:00:00.000Z',
  }))
  const before = canonicalImportValue(current)
  let code = ''
  try {
    mergeRiskImport(current, imported, 'sha256-completed-conflict')
  } catch (error) {
    code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  }
  assert(code === 'import-immutable-entity-conflict', '不同冻结元组必须按不可变实体冲突协议拒绝')
  assert(canonicalImportValue(current) === before, '冲突拒绝必须保持原输入原子不变')
}

export function testImportedDraftCannotDowngradeLocalCompletedReview(): void {
  const { current, imported } = completedReviewMergeFixtures()
  const local = current.weeklyReviews![0]!
  imported.weeklyReviews = imported.weeklyReviews!.map((review) => ({
    ...review,
    status: 'draft' as const,
    metricsSnapshot: null,
    evidenceSnapshot: undefined,
    riskSnapshot: undefined,
    completedAt: null,
    contentHtml: '<p>草稿导入内容</p>',
  }))
  const review = mergeRiskImport(current, imported, 'sha256-completed-vs-draft').weeklyReviews![0]!
  assert(review.contentHtml === '<p>草稿导入内容</p>', '较新的草稿仍可提供自由内容')
  assert(review.status === 'completed', '导入草稿不得降级本地完成态')
  assert(review.completedAt === local.completedAt, '导入草稿不得清除本地完成时间')
  assert(canonicalImportValue(review.metricsSnapshot) === canonicalImportValue(local.metricsSnapshot), '导入草稿不得清除指标快照')
  assert(canonicalImportValue(review.evidenceSnapshot) === canonicalImportValue(local.evidenceSnapshot), '导入草稿不得清除证据快照')
  assert(canonicalImportValue(review.riskSnapshot) === canonicalImportValue(local.riskSnapshot), '导入草稿不得清除风险快照')
}

export function testSameKindDifferentIdentityRemapsEveryReference(): void {
  const merged = mergeRiskImport(localFixture(), importedCollisionFixture(), 'sha256-a')
  const importedTrade = merged.trades.find((trade) => trade.ref === 'IMPORTED-1')
  assert(importedTrade?.id !== 'trade-1', '不同身份不得覆盖本地同 ID 交易')
  assert(merged.riskOverrideEvents?.[0]?.tradeId === importedTrade?.id, '顶层事件必须重映射')
  const review = merged.weeklyReviews?.find((item) => item.id === 'weekly-review:2026-07-20')
  assert(review?.riskSnapshot?.overrideEvents[0]?.tradeId === importedTrade?.id, '冻结事件必须重映射')
  assert(review?.highlightTradeIds[0] === importedTrade?.id, '高亮交易列表必须重映射')
  assert(review?.mistakeTradeIds[0] === importedTrade?.id, '错误交易列表必须重映射')
  assert(review?.followUpTradeIds[0] === importedTrade?.id, '跟进交易列表必须重映射')
  assert(review?.evidenceSnapshot?.trades[0]?.id === importedTrade?.id, '冻结交易证据必须重映射')
  assert(review?.evidenceSnapshot?.missedTrades[0]?.id === importedTrade?.id, '冻结错过机会证据必须重映射')
  assert(
    review?.evidenceSnapshot?.legacyCashCurrencyAssumption?.confirmedAt === '2026-07-27T08:00:00.000Z',
    '冻结证据重映射必须保留非实体字段',
  )
  assert(merged.starredIds[0] === importedTrade?.id, '收藏交易 ID 必须重映射')
  assert(merged.subscribedIds[0] === importedTrade?.id, '订阅交易 ID 必须重映射')
  assert(merged.trades.find((trade) => trade.id === 'case-1')?.sourceTradeId === importedTrade?.id, '案例来源必须重映射')
}

export function testRepeatedImportUsesStableRemap(): void {
  const once = mergeRiskImport(localFixture(), importedCollisionFixture(), 'sha256-a')
  const twice = mergeRiskImport(once, importedCollisionFixture(), 'sha256-a')
  assert(uniqueTradeIds(twice).length === uniqueTradeIds(once).length, '重复导入不得重复克隆')
  assert(
    once.trades.find((trade) => trade.ref === 'IMPORTED-1')?.id === stableImportedTradeId('sha256-a', 'trade-1'),
    '冲突交易 ID 必须由 payload digest 与原交易 ID 稳定派生',
  )
  assert(twice.riskOverrideEvents?.length === once.riskOverrideEvents?.length, '重复导入不得重复 override event')
}

export function testStableMappedIdOccupiedByDifferentTradeRejectsImport(): void {
  const digest = 'sha256-preoccupied'
  const current = localFixture()
  current.trades.push(identifiedTrade(
    stableImportedTradeId(digest, 'trade-1'),
    'UNRELATED-STABLE-ID-OCCUPANT',
    'XAUUSD',
    'create-unrelated-occupant',
  ))

  let errorMessage = ''
  try {
    mergeRiskImport(current, importedCollisionFixture(), digest)
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  assert(errorMessage.includes('稳定导入交易 ID'), '稳定映射 ID 被不同交易占用时必须明确拒绝整次导入')
}

export function testReferencesToExistingLocalTradeSurvivePartialImport(): void {
  const current = localFixture()
  const localTarget = identifiedTrade('existing-local-target', 'LOCAL-TARGET', 'GBPUSD', 'create-target')
  current.trades.push(localTarget)
  const imported = importedCollisionFixture()
  imported.trades = [{
    ...identifiedTrade('imported-case', 'IMPORTED-CASE', 'GBPUSD', 'create-imported-case'),
    tradeKind: 'case',
    sourceTradeId: localTarget.id,
  }]
  imported.riskOverrideEvents = []
  imported.weeklyReviews = imported.weeklyReviews?.map((review) => ({
    ...review,
    highlightTradeIds: [localTarget.id],
    mistakeTradeIds: [localTarget.id],
    followUpTradeIds: [localTarget.id],
    riskSnapshot: undefined,
  }))
  imported.starredIds = [localTarget.id]
  imported.subscribedIds = [localTarget.id]

  const merged = mergeRiskImport(current, imported, 'sha256-partial-import')
  const review = merged.weeklyReviews?.find((item) => item.id === 'weekly-review:2026-07-20')
  assert(merged.trades.find((trade) => trade.id === 'imported-case')?.sourceTradeId === localTarget.id, '片段导入的案例来源本地引用必须保留')
  assert(review?.highlightTradeIds[0] === localTarget.id, '片段导入的高亮本地引用必须保留')
  assert(review?.mistakeTradeIds[0] === localTarget.id, '片段导入的错误本地引用必须保留')
  assert(review?.followUpTradeIds[0] === localTarget.id, '片段导入的跟进本地引用必须保留')
  assert(merged.starredIds.includes(localTarget.id), '片段导入的收藏本地引用必须保留')
  assert(merged.subscribedIds.includes(localTarget.id), '片段导入的订阅本地引用必须保留')
}

export function testMissingCreateEvidenceRequiresCanonicalEquality(): void {
  const local = localFixture()
  const withoutEvidence = { ...local.trades[0]!, activities: undefined }
  const identical = mergeRiskImport(
    { ...local, trades: [withoutEvidence] },
    { ...local, trades: [{ ...withoutEvidence }], riskOverrideEvents: [], weeklyReviews: [] },
    'sha256-identical-legacy',
  )
  assert(identical.trades.length === 1, '缺少创建证据时只有逐字段 canonical 相等才可合并')
  const imported = { ...withoutEvidence, symbol: 'XAUUSD' }
  const merged = mergeRiskImport(
    { ...local, trades: [withoutEvidence] },
    { ...local, trades: [imported], riskOverrideEvents: [], weeklyReviews: [] },
    'sha256-missing-evidence',
  )
  assert(merged.trades.length === 2, '缺少创建证据且逐字段不同时必须保守判为不同交易')
}

export function testUnresolvedEventKeepsIdentitySummaryWithoutWrongLink(): void {
  const local = localFixture()
  const imported = importedCollisionFixture()
  imported.trades = imported.trades.filter((trade) => trade.id !== 'trade-1')
  imported.riskOverrideEvents = [{
    ...imported.riskOverrideEvents![0]!,
    tradeIdentityAtDecision: { ref: 'MISSING-REF', symbol: 'BTCUSDT', tradeKind: 'live' },
  }]
  imported.weeklyReviews = imported.weeklyReviews?.map((review) => ({
    ...review,
    riskSnapshot: review.riskSnapshot
      ? { ...review.riskSnapshot, overrideEvents: imported.riskOverrideEvents! }
      : undefined,
  }))
  imported.starredIds = []
  imported.subscribedIds = []
  const merged = mergeRiskImport(local, imported, 'sha256-unresolved')
  const event = merged.riskOverrideEvents?.find((item) => item.id === 'override-imported')
  assert(event?.linkState === 'unresolved', '无法完整链接的导入事件必须标记 unresolved')
  assert(event?.tradeIdentityAtDecision.ref === 'MISSING-REF', 'unresolved 事件必须保留导入身份摘要')
  assert(event?.tradeId === 'trade-1', 'unresolved 事件不得改写为其他交易 ID')
  assert(
    merged.weeklyReviews?.[0]?.riskSnapshot?.overrideEvents[0]?.linkState === 'unresolved',
    '冻结事件无法完整链接时也必须标记 unresolved',
  )
}

export function testFixtureDefaultsRemainValid(): void {
  assert(DEFAULT_DISPLAY.tradingDayStartHour >= 0, '测试 fixture 必须使用有效显示设置')
}

export function testCanonicalImportValueUsesLocaleIndependentCodePointOrder(): void {
  const canonical = canonicalImportValue({ 中: 3, a: 2, A: 1 })
  assert(canonical === '{"A":1,"a":2,"中":3}', '导入摘要必须按 code point 排序大小写与非 ASCII 键')
  assert(
    canonical === canonicalImportValue({ A: 1, 中: 3, a: 2 }),
    '相同 payload 的摘要输入不得受对象插入顺序影响',
  )
}

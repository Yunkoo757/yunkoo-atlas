import { matchImportedTrade, stableImportedTradeId, verifyImportAssets } from '@/lib/importTradeIdentity'
import type { Trade } from '@/data/trades'
import { canonicalImportValue } from '@/lib/importMerge'
import type { PersistedSlice } from '@/lib/importTypes'
import { mergeRiskImport } from '@/lib/riskImportMerge'
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
      previousCommitment: {
        weekStart: '2026-07-13', text: '复核开仓', criteria: '保留当时证据',
        evidence: [{ id: imported.id, ref: '冻结时编号', symbol: '冻结时品种', tradeKind: 'live' }],
      },
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

export async function testCompletedReviewWithSameFrozenTupleMergesEditableContent(): Promise<void> {
  const { current, imported } = completedReviewMergeFixtures()
  const local = current.weeklyReviews![0]!
  const merged = (await mergeRiskImport(current, imported, 'sha256-completed-same-freeze')).state
  const review = merged.weeklyReviews![0]!
  assert(review.contentHtml === '<p>导入的新内容</p>', '相同冻结元组必须允许合并较新的自由内容')
  assert(review.executionScore === 5, '相同冻结元组必须允许合并评分')
  assert(review.status === 'completed', '内容合并不得改变完成状态')
  assert(review.completedAt === local.completedAt, '内容合并不得改变完成时间')
  assert(canonicalImportValue(review.metricsSnapshot) === canonicalImportValue(local.metricsSnapshot), '内容合并不得改变指标快照')
  assert(canonicalImportValue(review.evidenceSnapshot) === canonicalImportValue(local.evidenceSnapshot), '内容合并不得改变证据快照')
  assert(canonicalImportValue(review.riskSnapshot) === canonicalImportValue(local.riskSnapshot), '内容合并不得改变风险快照')
}

export async function testCompletedReviewWithDifferentFrozenTupleRejectsAtomically(): Promise<void> {
  const { current, imported } = completedReviewMergeFixtures()
  imported.weeklyReviews = imported.weeklyReviews!.map((review) => ({
    ...review,
    completedAt: '2026-07-21T08:00:00.000Z',
  }))
  const before = canonicalImportValue(current)
  let code = ''
  try {
    await mergeRiskImport(current, imported, 'sha256-completed-conflict')
  } catch (error) {
    code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  }
  assert(code === 'import-immutable-entity-conflict', '不同冻结元组必须按不可变实体冲突协议拒绝')
  assert(canonicalImportValue(current) === before, '冲突拒绝必须保持原输入原子不变')
}

export async function testImportedDraftCannotDowngradeLocalCompletedReview(): Promise<void> {
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
  const review = (await mergeRiskImport(current, imported, 'sha256-completed-vs-draft')).state.weeklyReviews![0]!
  assert(review.contentHtml === '<p>草稿导入内容</p>', '较新的草稿仍可提供自由内容')
  assert(review.status === 'completed', '导入草稿不得降级本地完成态')
  assert(review.completedAt === local.completedAt, '导入草稿不得清除本地完成时间')
  assert(canonicalImportValue(review.metricsSnapshot) === canonicalImportValue(local.metricsSnapshot), '导入草稿不得清除指标快照')
  assert(canonicalImportValue(review.evidenceSnapshot) === canonicalImportValue(local.evidenceSnapshot), '导入草稿不得清除证据快照')
  assert(canonicalImportValue(review.riskSnapshot) === canonicalImportValue(local.riskSnapshot), '导入草稿不得清除风险快照')
}

export async function testSameKindDifferentIdentityRemapsEveryReference(): Promise<void> {
  const merged = (await mergeRiskImport(localFixture(), importedCollisionFixture(), 'sha256-a')).state
  const importedTrade = merged.trades.find((trade) => trade.ref === 'IMPORTED-1')
  assert(importedTrade?.id !== 'trade-1', '不同身份不得覆盖本地同 ID 交易')
  assert(merged.riskOverrideEvents?.[0]?.tradeId === importedTrade?.id, '顶层事件必须重映射')
  const review = merged.weeklyReviews?.find((item) => item.id === 'weekly-review:2026-07-20')
  assert(review?.riskSnapshot?.overrideEvents[0]?.tradeId === importedTrade?.id, '冻结事件必须重映射')
  const commitment = review?.previousCommitment?.evidence[0]
  assert(commitment?.id === importedTrade?.id && commitment?.ref === '冻结时编号' && commitment?.symbol === '冻结时品种',
    '上周承诺的证据应指向导入的交易并保留冻结的显示信息')
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

export async function testRepeatedImportUsesStableRemap(): Promise<void> {
  const once = (await mergeRiskImport(localFixture(), importedCollisionFixture(), 'sha256-a')).state
  const twice = (await mergeRiskImport(once, importedCollisionFixture(), 'sha256-a')).state
  assert(uniqueTradeIds(twice).length === uniqueTradeIds(once).length, '重复导入不得重复克隆')
  assert(
    once.trades.find((trade) => trade.ref === 'IMPORTED-1')?.id === stableImportedTradeId('sha256-a', 'trade-1'),
    '冲突交易 ID 必须由 payload digest 与原交易 ID 稳定派生',
  )
  assert(twice.riskOverrideEvents?.length === once.riskOverrideEvents?.length, '重复导入不得重复 override event')
}

export async function testStableMappedIdOccupiedByDifferentTradeRejectsImport(): Promise<void> {
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
    await mergeRiskImport(current, importedCollisionFixture(), digest)
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  assert(errorMessage.includes('稳定导入交易 ID'), '稳定映射 ID 被不同交易占用时必须明确拒绝整次导入')
}

export async function testTwoImportedTradesCannotShareOneTargetId(): Promise<void> {
  const digest = 'mapped-and-original'
  const reserved = stableImportedTradeId(digest, 'trade-1')
  for (const reversed of [false, true]) {
    const current = localFixture()
    const incoming = importedCollisionFixture()
    incoming.trades.push(identifiedTrade(reserved, 'OTHER-IMPORTED', 'ETHUSD', 'other-create'))
    if (reversed) incoming.trades.reverse()
    let error = ''
    try { await mergeRiskImport(current, incoming, digest) } catch (cause) { error = String(cause) }
    assert(error.includes(reserved), '两个来源需要同一目标 ID 时应报告冲突，不能按遍历顺序丢失一笔')
    assert(current.trades.length === 1 && current.trades[0]!.ref === 'LOCAL-1', '冲突不得更改本地交易')
  }
}

export async function testReferencesToExistingLocalTradeSurvivePartialImport(): Promise<void> {
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

  const merged = (await mergeRiskImport(current, imported, 'sha256-partial-import')).state
  const review = merged.weeklyReviews?.find((item) => item.id === 'weekly-review:2026-07-20')
  assert(merged.trades.find((trade) => trade.id === 'imported-case')?.sourceTradeId === localTarget.id, '片段导入的案例来源本地引用必须保留')
  assert(review?.highlightTradeIds[0] === localTarget.id, '片段导入的高亮本地引用必须保留')
  assert(review?.mistakeTradeIds[0] === localTarget.id, '片段导入的错误本地引用必须保留')
  assert(review?.followUpTradeIds[0] === localTarget.id, '片段导入的跟进本地引用必须保留')
  assert(merged.starredIds.includes(localTarget.id), '片段导入的收藏本地引用必须保留')
  assert(merged.subscribedIds.includes(localTarget.id), '片段导入的订阅本地引用必须保留')
}

export async function testMissingCreateEvidenceRequiresCanonicalEquality(): Promise<void> {
  const local = localFixture()
  const withoutEvidence = { ...local.trades[0]!, activities: undefined }
  const identical = (await mergeRiskImport(
    { ...local, trades: [withoutEvidence] },
    { ...local, trades: [{ ...withoutEvidence }], riskOverrideEvents: [], weeklyReviews: [] },
    'sha256-identical-legacy',
  )).state
  assert(identical.trades.length === 1, '缺少创建证据时只有逐字段 canonical 相等才可合并')
  const imported = { ...withoutEvidence, symbol: 'XAUUSD' }
  const merged = (await mergeRiskImport(
    { ...local, trades: [withoutEvidence] },
    { ...local, trades: [imported], riskOverrideEvents: [], weeklyReviews: [] },
    'sha256-missing-evidence',
  )).state
  assert(merged.trades.length === 2, '缺少创建证据且逐字段不同时必须保守判为不同交易')
}

export async function testUnresolvedEventKeepsIdentitySummaryWithoutWrongLink(): Promise<void> {
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
  const merged = (await mergeRiskImport(local, imported, 'sha256-unresolved')).state
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

export function testStoredImportedTradeIdCompatibility(): void {
  const id = stableImportedTradeId('sha256-a', '交易📈')
  assert(id === 'imported:fnv1a64:68eff98cee4e1516', id)
}

export async function testLegacyImageMatchPreservesHtmlAliasesSelectionAndMediaType(): Promise<void> {
  const base = { ...identifiedTrade('legacy', 'OLD', 'BTCUSDT', 'unused'), activities: undefined, tradeKind: 'case' as const }
  const img = (id: string) => '<img src="journal-asset://' + id + '">'
  const local = { ...base, note: img('a') + img('b'), sourceNoteHtml: img('a'), decisionImageId: 'a' }
  const incoming = { ...base, note: img('x') + img('y'), sourceNoteHtml: img('x'), decisionImageId: 'x' }
  let reads = 0
  const files = ['x', 'y'].map(id => ({ id, mime: 'image/png', data: 'YQ==' }))
  const verify = verifyImportAssets(files, async id => {
    reads++
    return { id, mime: 'image/png', data: 'YQ==' }
  })
  for (const other of [
    { ...incoming, sourceNoteHtml: img('y') }, { ...incoming, decisionImageId: 'y' },
    { ...incoming, note: '<p>另一段正文</p>' + incoming.note }, { ...incoming, symbol: 'ETHUSD' },
  ]) {
    assert(await matchImportedTrade(local, other, verify) === 'different', '图片关系、标记、正文或其他字段有变化时不得复用原交易')
  }
  assert(reads === 0, '字段足以排除的交易不必读取附件')
  assert(await matchImportedTrade(local, incoming, verify) === 'identical', '可验证的一对一图片重编号应匹配')
  assert(await matchImportedTrade(local, incoming, verify) === 'identical' && reads === 2, '同次候选的一对附件只读取一次')
  for (const mime of ['image/jpeg', null]) {
    const compare = verifyImportAssets(files, async id => mime ? { id, mime, data: 'YQ==' } : null)
    assert(await matchImportedTrade(local, incoming, compare) === 'different', '编码类型不同或缺少文件时不能确认同一份证据')
  }
}

export async function testLegacyCaseComparesItsAssignedSourceInEitherImportOrder(): Promise<void> {
  const initial = localFixture()
  const incoming = importedCollisionFixture()
  const [source, originalCase] = incoming.trades
  const child = { ...originalCase!, activities: [] }
  const grandchild = { ...child, id: 'nested-case', ref: 'CASE-NESTED', sourceTradeId: child.id }
  for (const sequence of [[grandchild, child, source!], [source!, child, grandchild]]) {
    const batch = { ...incoming, trades: sequence }
    const first = (await mergeRiskImport(initial, batch, 'legacy-sources')).state
    const repeated = (await mergeRiskImport(first, batch, 'legacy-sources')).state
    assert(repeated.trades.length === 4 && repeated.trades.find(t => t.id === child.id)?.sourceTradeId === stableImportedTradeId('legacy-sources', source!.id),
      '来源被重新编号后，不论输入顺序，历史案例与其后续案例都不得增殖')
    assert(repeated.trades.find(t => t.id === grandchild.id)?.sourceTradeId === child.id, '嵌套来源应指向同一案例')
  }
}

export async function testLegacySourceCyclesPreserveExistingRecordsAndRemainReplayable(): Promise<void> {
  const base = localFixture()
  const record = (id: string, sourceTradeId: string): Trade => ({
    ...identifiedTrade(id, 'CASE-' + id, 'BTCUSDT', 'unused'), tradeKind: 'case', activities: [], sourceTradeId,
  })
  const a = record('a', 'b'), b = record('b', 'a'), self = record('self', 'self')
  const digest = 'historic-source-cycle'
  const mappedA = stableImportedTradeId(digest, a.id)
  const mappedB = stableImportedTradeId(digest, b.id)
  for (const order of [[a, b, self], [self, b, a]]) {
    const batch = { ...base, trades: order }
    const scenarios = [
      { local: [a, b, self], length: 3, a: 'a', b: 'b' },
      { local: [{ ...a, note: '本地另一个案例' }], length: 4, a: mappedA, b: 'b' },
      // A 要求原 B，B 要求重编号的 A，无法同时复用。现有两份资料均须保留。
      { local: [a, { ...b, sourceTradeId: mappedA }], length: 5, a: mappedA, b: mappedB },
    ]
    for (const scenario of scenarios) {
      const first = await mergeRiskImport({ ...base, trades: scenario.local }, batch, digest)
      const replay = await mergeRiskImport(first.state, batch, digest)
      assert(first.state.trades.length === scenario.length && replay.state.trades.length === scenario.length,
        '历史循环来源的首次与再次导入应得到同一组记录')
      assert(replay.tradeIds.get('a') === scenario.a && replay.tradeIds.get('b') === scenario.b &&
        replay.state.trades.find(t => t.id === scenario.a)?.sourceTradeId === scenario.b &&
        replay.state.trades.find(t => t.id === scenario.b)?.sourceTradeId === scenario.a &&
        replay.state.trades.find(t => t.id === 'self')?.sourceTradeId === 'self', '循环与自引用不应受输入顺序影响')
    }
  }
}

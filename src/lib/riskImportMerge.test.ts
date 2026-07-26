import type { Trade } from '@/data/trades'
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

import fs from 'node:fs'
import { createDefaultReviewTemplates } from '@/data/reviewTemplates'
import { createDefaultStrategies } from '@/config/defaultProfile'
import { buildWebJournalArchiveBlob, parseImportJson } from '@/lib/importExport'
import { parseWebJournalArchive } from '@/lib/webJournalArchive'
import { PERSISTED_SNAPSHOT_FIELDS } from '@/storage/persistedKeys'
import {
  decodeCanonicalSnapshot,
  type CanonicalSnapshot,
} from '@/storage/snapshotCodec'
import {
  FULL_SNAPSHOT_ASSET_IDS,
  createFullPersistedSnapshotFixture,
  canonicalContractJson,
} from '@/storage/fixtures/fullPersistedSnapshot'
import { SCHEMA_VERSION, type PersistedSnapshot } from '@/storage/types'
import { filterLivePerformanceRecords, resolveLiveArchiveScope } from '@/lib/liveStatisticsArchive'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertThrows(run: () => unknown, message: string): void {
  let threw = false
  try {
    run()
  } catch {
    threw = true
  }
  assert(threw, message)
}

function assertThrowsMatching(run: () => unknown, pattern: RegExp, message: string): void {
  try {
    run()
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return
    throw new Error(`${message}：收到非预期错误 ${String(error)}`)
  }
  throw new Error(`${message}：函数没有抛错`)
}

function minimalHistoricalSnapshot(): Record<string, unknown> {
  return {
    trades: [],
    strategies: [],
  }
}

export function testSnapshotCodecNormalizesVersionsOneThroughEightToAllContractFields(): void {
  for (let version = 1; version <= 8; version += 1) {
    const canonical = decodeCanonicalSnapshot(minimalHistoricalSnapshot(), { version })
    assert(
      canonicalContractJson(Object.keys(canonical).sort()) === canonicalContractJson([...PERSISTED_SNAPSHOT_FIELDS].sort()),
      `v${version} 必须规范化为完整 22 字段 CanonicalSnapshot`,
    )
    for (const field of PERSISTED_SNAPSHOT_FIELDS) {
      assert(canonical[field] !== undefined, `v${version} 字段 ${field} 不得为 undefined`)
    }
  }
}

export function testVersionElevenSnapshotMigratesToCanonicalStageOwnership(): void {
  const legacy = structuredClone(createFullPersistedSnapshotFixture()) as unknown as Record<string, unknown>
  delete legacy.liveStages
  delete legacy.currentLiveStageId
  delete legacy.scheduledStageRollover
  legacy.livePerformanceCycles = [
    { id: 'legacy-old', name: '旧阶段', startTradingDayKey: '2026-07-01', createdAt: '2026-07-01T00:00:00.000Z' },
    { id: 'legacy-current', name: '当前阶段', startTradingDayKey: '2026-07-13', createdAt: '2026-07-13T00:00:00.000Z' },
  ]
  const decoded = decodeCanonicalSnapshot(legacy, {
    version: 11,
    stageMigration: {
      now: '2026-08-22T00:00:00.000Z',
      currentTradingDayKey: '2026-08-22',
      idFactory: (sequence) => `codec-stage-${sequence}`,
    },
  })

  assert(decoded.liveStages.length === 2, 'v11 codec 必须将旧周期迁移为阶段')
  assert(decoded.currentLiveStageId === 'codec-stage-2', 'v11 codec 必须保留当前阶段指针')
  assert(decoded.trades[0]?.tradeKind === 'live' && decoded.trades[0].liveStageId === 'codec-stage-2', 'v11 实盘交易必须按平仓日归属')
  assert(decoded.weeklyReviews[0]?.liveStageId === 'codec-stage-2', 'v11 周复盘必须按 weekStart 归属')
}

export function testVersionTwelveCodecRequiresCanonicalStageFields(): void {
  const fixture = structuredClone(createFullPersistedSnapshotFixture()) as unknown as Record<string, unknown>
  for (const field of ['liveStages', 'currentLiveStageId', 'scheduledStageRollover']) {
    const missing = { ...fixture }
    delete missing[field]
    assertThrowsMatching(
      () => decodeCanonicalSnapshot(missing, { version: 12 }),
      /stage|Stage|阶段/,
      `v12 缺少 ${field} 必须拒绝`,
    )
  }
}

export function testVersionTenSnapshotWithoutPerformanceCyclesUsesEmptyBoundaries(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const missing = { ...fixture }
  delete (missing as { livePerformanceCycles?: unknown }).livePerformanceCycles
  const decoded = decodeCanonicalSnapshot(missing, { version: SCHEMA_VERSION })
  assert(decoded.livePerformanceCycles.length === 0, 'v10 缺少实盘边界必须恢复为空数组')
  assert(
    canonicalContractJson(decoded.weeklyReviews) === canonicalContractJson(fixture.weeklyReviews),
    '补齐缺省边界不得改写周复盘快照',
  )
}

export function testLegacySnapshotLoadsWithNoCashCurrencyAssumptionAndPreservesTradeFacts(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const legacy = structuredClone(fixture) as unknown as Record<string, unknown>
  const profile = { ...(legacy.profile as Record<string, unknown>) }
  delete profile.legacyCashCurrencyAssumption
  legacy.profile = profile
  legacy.trades = [
    { ...fixture.trades[0], id: 'legacy-missing-currency' },
    { ...fixture.trades[0], id: 'explicit-unknown-currency', cashCurrency: null },
  ]
  delete (legacy.trades as Array<Record<string, unknown>>)[0]!.cashCurrency

  const decoded = decodeCanonicalSnapshot(legacy, { version: 10 })
  assert(decoded.profile.legacyCashCurrencyAssumption === null, 'v10 profile 必须迁移为未确认假设')
  assert(
    !Object.prototype.hasOwnProperty.call(decoded.trades[0]!, 'cashCurrency'),
    '旧交易缺失 cashCurrency 必须继续保持缺字段，不得迁移成 USD',
  )
  assert(decoded.trades[1]!.cashCurrency === null, '显式 unknown 币种必须逐字保留')
}

export function testConfirmedCashCurrencyAssumptionSurvivesCanonicalRoundTrip(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const assumption = { currency: 'USD' as const, confirmedAt: '2026-08-09T04:00:00.000Z' }
  const once = decodeCanonicalSnapshot({
    ...fixture,
    profile: { ...fixture.profile!, legacyCashCurrencyAssumption: assumption },
  }, { version: SCHEMA_VERSION })
  const twice = decodeCanonicalSnapshot(once, { version: SCHEMA_VERSION })

  assert(
    canonicalContractJson(twice.profile.legacyCashCurrencyAssumption) === canonicalContractJson(assumption),
    '显式 USD 假设必须在当前 schema round-trip 后保持不变',
  )
}

export function testSnapshotCodecIsIdempotentAndPreservesTheFullGoldenFixture(): void {
  const expected = createFullPersistedSnapshotFixture()
  const once = decodeCanonicalSnapshot(expected, { version: SCHEMA_VERSION })
  const twice = decodeCanonicalSnapshot(once, { version: SCHEMA_VERSION })
  for (const field of PERSISTED_SNAPSHOT_FIELDS) {
    assert(
      canonicalContractJson(once[field]) === canonicalContractJson(twice[field]),
      `重复 normalize 不得改变字段 ${field}`,
    )
    assert(
      canonicalContractJson(once[field]) === canonicalContractJson(expected[field]),
      `FND1 codec 不得改变 H0 golden 字段 ${field}`,
    )
  }
}

export function testExplicitNullCloseDateSurvivesFullSnapshotReload(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const cleaned = {
    ...fixture.trades[0]!,
    status: 'win' as const,
    tradeKind: 'live' as const,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported' as const,
    openedAt: '2025-11-03',
    closedAt: null,
  }
  delete cleaned.closedTradingDayKey
  const persistedBytes = JSON.stringify({ ...fixture, trades: [cleaned] })
  const decoded = decodeCanonicalSnapshot(JSON.parse(persistedBytes), { version: SCHEMA_VERSION })
  const reloaded = decoded.trades[0]!

  assert(Object.prototype.hasOwnProperty.call(reloaded, 'closedAt'), '重载后必须保留显式 closedAt own property')
  assert(reloaded.closedAt === null, '清理后的显式 null 不得被旧迁移重新复制 openedAt')
  assert(reloaded.closedTradingDayKey === undefined, '重载后不得重新生成冻结平仓业务日')
  const cycles = [{ id: 'current', name: '当前', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' }]
  assert(
    filterLivePerformanceRecords(decoded.trades, resolveLiveArchiveScope(cycles, 'all-archives'), 6).length === 0,
    '重启加载后统一绩效选择器仍必须排除清理记录',
  )
}

export function testV1DecodeKeepsMissingAndExplicitNullCloseDatesDistinctAcrossRoundTrip(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const missing = {
    ...fixture.trades[0]!,
    id: 'v1-missing-close',
    ref: 'TRD-V1-MISSING',
  }
  delete (missing as { closedAt?: string | null }).closedAt
  delete missing.closedTradingDayKey
  const explicitNull = {
    ...fixture.trades[0]!,
    id: 'v1-explicit-null',
    ref: 'TRD-V1-NULL',
    closedAt: null,
  }
  delete explicitNull.closedTradingDayKey
  const persistedV1 = JSON.parse(JSON.stringify({
    ...fixture,
    trades: [missing, explicitNull],
  })) as { trades: Record<string, unknown>[] }

  assert(!Object.prototype.hasOwnProperty.call(persistedV1.trades[0], 'closedAt'), 'v1 fixture 必须真实缺少 closedAt')
  assert(Object.prototype.hasOwnProperty.call(persistedV1.trades[1], 'closedAt'), '显式 null fixture 必须保留 closedAt own property')
  const decodedV1 = decodeCanonicalSnapshot(persistedV1, { version: 1 })
  const decodedMissing = decodedV1.trades.find((trade) => trade.id === 'v1-missing-close')!
  const decodedNull = decodedV1.trades.find((trade) => trade.id === 'v1-explicit-null')!

  assert(decodedMissing.closedAt === missing.openedAt, '完整 v1 终态缺失字段必须兼容回填 openedAt')
  assert(decodedMissing.closedTradingDayKey === '2026-07-16', 'v1 缺失字段回填后必须生成对应冻结业务日')
  assert(decodedNull.closedAt === null, 'v1 显式 null 不得被误判为缺失并回填')
  assert(decodedNull.closedTradingDayKey === undefined, 'v1 显式 null 不得生成冻结业务日')

  const roundTrip = decodeCanonicalSnapshot(
    JSON.parse(JSON.stringify(decodedV1)),
    { version: SCHEMA_VERSION },
  )
  assert(roundTrip.trades.find((trade) => trade.id === 'v1-missing-close')?.closedAt === missing.openedAt, '当前 codec round-trip 必须保持 v1 兼容回填值')
  assert(roundTrip.trades.find((trade) => trade.id === 'v1-explicit-null')?.closedAt === null, '当前 codec round-trip 必须保持显式 null')
}

export function testSnapshotCodecPreservesCaseSourceNoteSnapshotsWithoutBackfillingLegacyCases(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const { sourceNoteHtml: _sourceNoteHtml, ...legacyTrade } = fixture.trades[0]!
  const legacyNote = '<p>历史混合正文</p>'
  const legacyCase = {
    ...legacyTrade,
    tradeKind: 'case' as const,
    sourceTradeId: 'source-trade',
    note: legacyNote,
  }
  assert(
    !Object.prototype.hasOwnProperty.call(legacyCase, 'sourceNoteHtml'),
    '构造的旧版本 case 必须确实缺少 sourceNoteHtml own property',
  )
  assert(legacyCase.note === legacyNote, '构造旧版本 case 时不得改写 note')
  const legacyPayload = JSON.parse(JSON.stringify({ ...fixture, trades: [legacyCase] })) as {
    trades: Record<string, unknown>[]
  }
  assert(
    !Object.prototype.hasOwnProperty.call(legacyPayload.trades[0]!, 'sourceNoteHtml'),
    'JSON 往返后的旧版本 case 必须继续缺少 sourceNoteHtml own property',
  )
  assert(legacyPayload.trades[0]?.note === legacyNote, 'JSON 往返不得改写旧版本 case note')
  const legacy = decodeCanonicalSnapshot(
    legacyPayload,
    { version: SCHEMA_VERSION },
  )
  assert(
    !Object.prototype.hasOwnProperty.call(legacy.trades[0]!, 'sourceNoteHtml'),
    '旧版本 case 不得补写空 sourceNoteHtml 字段',
  )
  assert(legacy.trades[0]?.note === legacyNote, '旧版本 case 不得改写 note')

  const sourceNoteHtml = '<p>来源快照：逐字保留 &amp; 不混入洞见</p>'
  const current = decodeCanonicalSnapshot(
    JSON.parse(JSON.stringify({
      ...fixture,
      trades: [{ ...legacyCase, sourceNoteHtml }],
    })),
    { version: SCHEMA_VERSION },
  )
  assert(current.trades[0]?.sourceNoteHtml === sourceNoteHtml, 'case 来源快照必须经 JSON 往返逐字保留')
}

export function testSnapshotCodecDistinguishesMissingDefaultsFromExplicitEmptyValues(): void {
  const missing = decodeCanonicalSnapshot(minimalHistoricalSnapshot(), { version: 1 })
  const explicit = decodeCanonicalSnapshot({
    ...minimalHistoricalSnapshot(),
    reviewTemplates: [],
    symbolCatalog: [],
  }, { version: 8 })

  assert(
    canonicalContractJson(missing.reviewTemplates) === canonicalContractJson(createDefaultReviewTemplates()),
    '缺失 reviewTemplates 必须使用既有默认模板',
  )
  assert(explicit.reviewTemplates.length === 0, '显式空 reviewTemplates 必须保留为空')
  assert(explicit.symbolCatalog.length === 0, '显式空 symbolCatalog 必须保留为空')

  const missingStrategies = decodeCanonicalSnapshot({ trades: [] }, { version: 1 })
  assert(
    canonicalContractJson(missingStrategies.strategies) === canonicalContractJson(createDefaultStrategies()),
    '缺失 strategies 必须使用既有默认策略',
  )
  assert(
    decodeCanonicalSnapshot({ trades: [], strategies: [] }, { version: 8 }).strategies.length === 0,
    '显式空 strategies 必须保留真正空库语义',
  )
}

export function testSnapshotCodecRejectsWrongTypesAndFutureVersionsBeforeNormalization(): void {
  assertThrows(
    () => decodeCanonicalSnapshot({ ...minimalHistoricalSnapshot(), quickNotes: {} }, { version: 8 }),
    '存在但类型错误的字段不得由默认值掩盖',
  )
  assertThrows(
    () => decodeCanonicalSnapshot(minimalHistoricalSnapshot(), { version: SCHEMA_VERSION + 1 }),
    '未来版本必须在进入业务策略前拒绝',
  )
  for (const field of [
    'trades',
    'weeklyReviews',
    'quickNotes',
    'strategies',
    'starredIds',
    'subscribedIds',
    'pinnedStrategyIds',
  ]) {
    assertThrows(
      () => decodeCanonicalSnapshot({ ...minimalHistoricalSnapshot(), [field]: null }, { version: 8 }),
      `显式 null 字段 ${field} 不得被当成缺失值`,
    )
  }
  for (const display of [
    { privacyMode: 'yes' },
    { sidebarPrimaryOrder: 'today' },
  ]) {
    assertThrows(
      () => decodeCanonicalSnapshot({ ...minimalHistoricalSnapshot(), display }, { version: 8 }),
      '存在但类型错误的 display 子字段必须拒绝',
    )
  }
  assertThrows(
    () => decodeCanonicalSnapshot({
      ...minimalHistoricalSnapshot(),
      symbolIcons: { BTCUSDT: { presetId: 'btc', updatedAt: '' } },
    }, { version: 8 }),
    '空 updatedAt 不得触发基于当前时间的非确定性规范化',
  )
}

function fullSnapshotWithWeeklyRiskReview() {
  const fixture = createFullPersistedSnapshotFixture()
  const event = fixture.riskOverrideEvents[0]!
  const review = fixture.weeklyReviews![0]!
  return {
    ...fixture,
    weeklyReviews: [{
      ...review,
      riskSnapshot: {
        policyVersions: fixture.riskPolicyVersions,
        dailyOutcomes: [{ ...event.outcomesAtDecision.day, date: '2026-07-17' }],
        weeklyOutcome: event.outcomesAtDecision.week,
        monthlyOutcomeAtCompletion: event.outcomesAtDecision.month,
        overrideEvents: fixture.riskOverrideEvents,
        frozenAt: review.completedAt!,
      },
    }],
  }
}

export function testV9RequiresEveryRiskField(): void {
  const full = createFullPersistedSnapshotFixture()
  for (const field of [
    'weeklyRiskPreparations',
    'riskPolicyVersions',
    'monthlyRiskLimits',
    'riskOverrideEvents',
  ] as const) {
    const candidate = { ...full } as Record<string, unknown>
    delete candidate[field]
    assertThrowsMatching(
      () => decodeCanonicalSnapshot(candidate, { version: SCHEMA_VERSION }),
      new RegExp(`缺少必需字段.*${field}`),
      `当前 Schema 缺少 ${field} 必须因该字段拒绝`,
    )
  }
}

export function testV9DefaultsMissingLiveCycleStartAndPreservesValidValue(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const missing = { ...fixture } as Record<string, unknown>
  delete missing.liveStatsStartTradingDayKey
  assert(
    decodeCanonicalSnapshot(missing, { version: 9 }).liveStatsStartTradingDayKey === null,
    '缺失起点必须规范化为 null',
  )
  assert(
    decodeCanonicalSnapshot(
      { ...fixture, liveStatsStartTradingDayKey: '2026-07-27' },
      { version: 9 },
    ).liveStatsStartTradingDayKey === '2026-07-27',
    '合法起点必须往返',
  )
}

export function testV10SnapshotCodecRejectsUnaddressablePerformanceCycleIds(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const accepted: string[] = []
  for (const id of [' padded-id ', 'all', 'pre-cycle', 'current']) {
    try {
      decodeCanonicalSnapshot({
        ...fixture,
        livePerformanceCycles: [{ ...fixture.livePerformanceCycles![0]!, id }],
      }, { version: 10, label: 'v10 import snapshot' })
      accepted.push(id)
    } catch (error) {
      assert(
        /livePerformanceCycles.*周期 ID/.test(error instanceof Error ? error.message : String(error)),
        `v10 拒绝 ${id} 时必须指出周期 ID 契约`,
      )
    }
  }
  assert(accepted.length === 0, `v10 恢复/导入必须拒绝不可寻址周期 ID，实际接受：${accepted.join(',')}`)
}

export function testV10AndV9DefaultMissingCyclesToEmptyBoundaries(): void {
  const full = createFullPersistedSnapshotFixture()
  const missing = { ...full } as Record<string, unknown>
  delete missing.livePerformanceCycles
  assert(
    decodeCanonicalSnapshot(missing, { version: 10 }).livePerformanceCycles.length === 0,
    'v10 缺少周期字段必须保持空边界兼容语义',
  )
  const legacy = decodeCanonicalSnapshot(missing, { version: 9 })
  assert(legacy.livePerformanceCycles.length === 0, 'v9 必须迁移为空周期且保持全部历史')
}

export function testV8BackfillsRiskFields(): void {
  const decoded = decodeCanonicalSnapshot(minimalHistoricalSnapshot(), { version: 8 })
  assert(decoded.weeklyRiskPreparations.length === 0, 'v8 应补空 preparation 数组')
  assert(decoded.riskPolicyVersions.length === 0, 'v8 应补空 policy 数组')
  assert(decoded.monthlyRiskLimits.length === 0, 'v8 应补空 monthly limit 数组')
  assert(decoded.riskOverrideEvents.length === 0, 'v8 应补空 override event 数组')
}

export function testWeeklyRiskReviewSnapshotSurvivesCodecAndJsonAndRejectsMalformedV9(): void {
  const fixture = fullSnapshotWithWeeklyRiskReview()
  const assets = Object.values(FULL_SNAPSHOT_ASSET_IDS).map((id, index) => ({
    id,
    mime: 'image/png',
    data: Buffer.from([index, 71, 72, 73]).toString('base64'),
  }))
  const decoded = decodeCanonicalSnapshot(fixture, { version: SCHEMA_VERSION })
  assert(decoded.weeklyReviews[0]?.riskSnapshot?.overrideEvents[0]?.reason === '合同覆盖原因', 'codec 重载必须保留冻结事件')

  const json = parseImportJson(JSON.stringify({ version: SCHEMA_VERSION, ...fixture, assets }))
  assert(json.ok, 'JSON reader 必须接受合法周复盘风险快照')
  assert(json.data.weeklyReviews?.[0]?.riskSnapshot?.frozenAt === fixture.weeklyReviews[0]!.completedAt, 'JSON 重载必须保留冻结时间')

  const malformed = structuredClone(fixture)
  malformed.weeklyReviews[0]!.riskSnapshot!.weeklyOutcome.coverage = 'safe' as 'complete'
  assertThrows(
    () => decodeCanonicalSnapshot(malformed, { version: SCHEMA_VERSION }),
    '原生 v9 codec 必须拒绝损坏的周复盘风险快照',
  )
  const malformedJson = parseImportJson(JSON.stringify({ version: SCHEMA_VERSION, ...malformed, assets }))
  assert(!malformedJson.ok, 'JSON reader 必须拒绝损坏的周复盘风险快照')
}

export function testV8BackfillsClosedTradingDayKeyFromSnapshotDisplay(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const decoded = decodeCanonicalSnapshot({
    ...fixture,
    trades: fixture.trades.map((trade) => ({
      ...trade,
      closedAt: '2026-07-27T05:59:00+08:00',
      closedTradingDayKey: undefined,
    })),
    display: { ...fixture.display, tradingDayStartHour: 6 },
  }, { version: 8 })
  assert(decoded.trades[0]?.closedTradingDayKey === '2026-07-26', '时间戳必须按 v8 快照自身边界固化')
}

export function testV8BackfillsClosedTradingDayKeyWithoutShiftingDateStrings(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const decoded = decodeCanonicalSnapshot({
    ...fixture,
    trades: fixture.trades.map((trade) => ({
      ...trade,
      closedAt: '2026-07-27',
      closedTradingDayKey: undefined,
    })),
    display: { ...fixture.display, tradingDayStartHour: 6 },
  }, { version: 8 })
  assert(decoded.trades[0]?.closedTradingDayKey === '2026-07-27', '日期字符串不得二次换日')
}

export function testV8OnlyBackfillsClosedLiveTrades(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const decoded = decodeCanonicalSnapshot({
    ...fixture,
    trades: fixture.trades.map((trade) => ({
      ...trade,
      status: 'planned',
      closedAt: '2026-07-27',
      closedTradingDayKey: undefined,
    })),
  }, { version: 8 })
  assert(decoded.trades[0]?.closedTradingDayKey === undefined, '非终态交易不得生成平仓业务日事实')
}

export function testV8BackfillUsesDefaultTradingDayBoundaryWhenDisplayOmitsIt(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const { tradingDayStartHour: _startHour, ...displayWithoutBoundary } = fixture.display
  const decoded = decodeCanonicalSnapshot({
    ...fixture,
    trades: fixture.trades.map((trade) => ({
      ...trade,
      closedAt: '2026-07-27T05:30:00+08:00',
      closedTradingDayKey: undefined,
    })),
    display: displayWithoutBoundary,
  }, { version: 8 })
  assert(decoded.trades[0]?.closedTradingDayKey === '2026-07-26', '缺省边界必须使用产品默认 6 点')
}

export function testV8BackfillLeavesInvalidDatesAndTerminalPaperTradesWithoutKeys(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const [trade] = fixture.trades
  const decoded = decodeCanonicalSnapshot({
    ...fixture,
    trades: [
      { ...trade, id: 'invalid-date', closedAt: '2026-02-30', closedTradingDayKey: undefined },
      { ...trade, id: 'paper-trade', tradeKind: 'paper', closedTradingDayKey: undefined },
    ],
  }, { version: 8 })
  assert(decoded.trades[0]?.closedTradingDayKey === undefined, '非法 closedAt 必须保持缺失 key')
  assert(decoded.trades[1]?.closedTradingDayKey === undefined, '终态 paper 交易不得回填 live 风险事实')
}

export function testSnapshotCodecAppliesOnlyTheKnownVersionSpecificTradeMigrations(): void {
  const [currentTrade] = createFullPersistedSnapshotFixture().trades
  const { strategyId: _strategyId, tradeKind: _tradeKind, ...legacyTrade } = currentTrade
  const v6 = decodeCanonicalSnapshot({
    ...minimalHistoricalSnapshot(),
    trades: [{ ...legacyTrade, strategy: currentTrade.strategyId, tradeKind: 'practice' }],
    strategies: createFullPersistedSnapshotFixture().strategies,
  }, { version: 6 })
  assert(v6.trades[0]?.strategyId === currentTrade.strategyId, 'v1–v6 strategy 别名必须迁移为 strategyId')
  assert(v6.trades[0]?.tradeKind === 'paper', 'v1–v6 practice 必须迁移为 paper')

  assertThrows(
    () => decodeCanonicalSnapshot({
      ...minimalHistoricalSnapshot(),
      trades: [{ ...legacyTrade, strategy: currentTrade.strategyId, tradeKind: 'practice' }],
    }, { version: 8 }),
    '当前 v8 不得继续把错误 tradeKind 静默当成历史格式',
  )
}

export function testSnapshotCodecIgnoresDeprecatedFieldsWithoutWritingThemBack(): void {
  const canonical: CanonicalSnapshot = decodeCanonicalSnapshot({
    ...minimalHistoricalSnapshot(),
    cases: [{ id: 'legacy-case' }],
    disputeTypes: ['legacy-dispute'],
  }, { version: 6 })
  assert(!('cases' in canonical), 'CanonicalSnapshot 不得写回 cases')
  assert(!('disputeTypes' in canonical), 'CanonicalSnapshot 不得写回 disputeTypes')
}

export async function testJsonAndWebReadersMatchTheCanonicalCodecGolden(): Promise<void> {
  const fixture = createFullPersistedSnapshotFixture()
  const expected = decodeCanonicalSnapshot(fixture, { version: SCHEMA_VERSION })
  const assets = Object.values(FULL_SNAPSHOT_ASSET_IDS).map((id, index) => ({
    id,
    mime: 'image/png',
    data: Buffer.from([index, 71, 72, 73]).toString('base64'),
  }))

  const json = parseImportJson(JSON.stringify({ version: SCHEMA_VERSION, ...fixture, assets }))
  assert(json.ok, 'JSON reader 必须接受 FND1 golden fixture')
  const web = await parseWebJournalArchive(buildWebJournalArchiveBlob(fixture, assets))
  for (const field of PERSISTED_SNAPSHOT_FIELDS) {
    assert(
      canonicalContractJson(json.data[field]) === canonicalContractJson(expected[field]),
      `JSON reader 字段 ${field} 必须等同中央 codec`,
    )
    assert(
      canonicalContractJson(web.snapshot[field]) === canonicalContractJson(expected[field]),
      `Web reader 字段 ${field} 必须等同中央 codec`,
    )
  }
}

export async function testFocusRingPreferenceFallsBackOnlyForInvalidNewFieldAcrossImportReaders(): Promise<void> {
  const fixture = createFullPersistedSnapshotFixture()
  const assets = Object.values(FULL_SNAPSHOT_ASSET_IDS).map((id, index) => ({
    id,
    mime: 'image/png',
    data: Buffer.from([index, 81, 82, 83]).toString('base64'),
  }))
  const invalid = {
    ...fixture,
    display: { ...fixture.display, showKeyboardFocusRings: 'yes' },
  } as unknown as PersistedSnapshot

  const decodedInvalid = decodeCanonicalSnapshot(invalid, { version: SCHEMA_VERSION })
  assert(
    decodedInvalid.display.showKeyboardFocusRings === false,
    '中央 codec 必须把非法焦点高光偏好回退为 false，而不是拒绝整份快照',
  )

  const jsonInvalid = parseImportJson(JSON.stringify({
    version: SCHEMA_VERSION,
    ...invalid,
    assets,
  }))
  assert(jsonInvalid.ok, '真实 JSON reader 必须接受仅新增焦点字段非法的快照')
  assert(
    jsonInvalid.data.display?.showKeyboardFocusRings === false,
    '真实 JSON reader 必须把非法焦点高光偏好回退为 false',
  )

  const webInvalid = await parseWebJournalArchive(buildWebJournalArchiveBlob(invalid, assets))
  assert(
    webInvalid.snapshot.display?.showKeyboardFocusRings === false,
    '真实网页日志 reader 必须把非法焦点高光偏好回退为 false',
  )

  const enabled = {
    ...fixture,
    display: { ...fixture.display, showKeyboardFocusRings: true },
  }
  const decodedEnabled = decodeCanonicalSnapshot(enabled, { version: SCHEMA_VERSION })
  assert(decodedEnabled.display.showKeyboardFocusRings === true, '中央 codec 必须保留 true')

  const jsonEnabled = parseImportJson(JSON.stringify({
    version: SCHEMA_VERSION,
    ...enabled,
    assets,
  }))
  assert(jsonEnabled.ok, '真实 JSON reader 必须接受 true 焦点高光偏好')
  assert(jsonEnabled.data.display?.showKeyboardFocusRings === true, '真实 JSON reader 必须保留 true')

  const webEnabled = await parseWebJournalArchive(buildWebJournalArchiveBlob(enabled, assets))
  assert(webEnabled.snapshot.display?.showKeyboardFocusRings === true, '真实网页日志 reader 必须保留 true')
}

export function testSnapshotCodecHasNoRuntimeOrPersistenceDependencies(): void {
  const source = [
    'src/storage/snapshotCodec.ts',
    'src/data/quickNoteCodec.ts',
    'src/lib/symbolIconCodec.ts',
    'src/lib/strategies.ts',
    'src/lib/tradeFilters.ts',
    'src/lib/sidebarNavContract.ts',
    'src/lib/sidebarWorkspace.ts',
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  for (const forbidden of [
    "from '@/store/",
    "from '@/storage/index'",
    "from '@/storage/runtime'",
    "from 'node:",
    "from '@/icons/",
    "from '@/lib/sidebarNav'",
    'electron/',
    'document.',
    'window.',
  ]) {
    assert(!source.includes(forbidden), `纯 snapshot codec 不得依赖 ${forbidden}`)
  }
}
// Quality-Scenario: H0-A-MISSING-*
// Quality-Scenario: H0-A-TYPE-*

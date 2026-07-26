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
import { SCHEMA_VERSION } from '@/storage/types'

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
      `v${version} 必须规范化为完整 20 字段 CanonicalSnapshot`,
    )
    for (const field of PERSISTED_SNAPSHOT_FIELDS) {
      assert(canonical[field] !== undefined, `v${version} 字段 ${field} 不得为 undefined`)
    }
  }
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

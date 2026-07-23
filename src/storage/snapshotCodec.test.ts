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
      `v${version} 必须规范化为完整 16 字段 CanonicalSnapshot`,
    )
    for (const field of PERSISTED_SNAPSHOT_FIELDS) {
      assert(canonical[field] !== undefined, `v${version} 字段 ${field} 不得为 undefined`)
    }
  }
}

export function testSnapshotCodecIsIdempotentAndPreservesTheFullGoldenFixture(): void {
  const expected = createFullPersistedSnapshotFixture()
  const once = decodeCanonicalSnapshot(expected, { version: 8 })
  const twice = decodeCanonicalSnapshot(once, { version: 8 })
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
    () => decodeCanonicalSnapshot(minimalHistoricalSnapshot(), { version: 9 }),
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
  const expected = decodeCanonicalSnapshot(fixture, { version: 8 })
  const assets = Object.values(FULL_SNAPSHOT_ASSET_IDS).map((id, index) => ({
    id,
    mime: 'image/png',
    data: Buffer.from([index, 71, 72, 73]).toString('base64'),
  }))

  const json = parseImportJson(JSON.stringify({ version: 8, ...fixture, assets }))
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

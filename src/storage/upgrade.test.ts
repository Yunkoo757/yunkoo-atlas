import { SCHEMA_VERSION } from '@/storage/types'
import {
  migrateSnapshot,
  migrateSnapshotToCurrent,
  type SnapshotMigrationStep,
} from '@/storage/upgrade'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function historicalTrade(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'legacy',
    ref: 'TRD-legacy',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'open',
    conviction: 'medium',
    strategyId: '',
    tradeKind: 'live',
    tags: [],
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-01-01',
    closedAt: null,
    note: '',
    ...overrides,
  }
}

export function testCurrentLibrarySnapshotRemainsAnIdentityMigration(): void {
  const raw = {
    trades: [],
    strategies: [],
    marker: 'must-survive',
  }

  const result = migrateSnapshotToCurrent(raw, {
    source: 'library',
    manifestSchemaVersion: SCHEMA_VERSION,
  })

  assert(result.fromVersion === SCHEMA_VERSION, 'current manifest version should be detected')
  assert(result.toVersion === SCHEMA_VERSION, 'current load must not target a future schema')
  assert(result.didChange === false, 'current snapshots should not be rewritten')
  assert(
    (result.snapshot as unknown) === raw,
    'identity migration should preserve the original object',
  )
}

export function testEmbeddedAndManifestVersionsCannotDisagree(): void {
  let message = ''
  try {
    migrateSnapshotToCurrent(
      { schemaVersion: SCHEMA_VERSION, trades: [], strategies: [] },
      {
        source: 'library',
        manifestSchemaVersion: SCHEMA_VERSION - 1,
      },
    )
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }

  assert(message.includes('版本不一致'), 'version disagreement must stop the load')
}

export function testFutureSnapshotsAreRejectedWithoutMutation(): void {
  const raw = {
    schemaVersion: SCHEMA_VERSION + 1,
    trades: [],
    strategies: [],
  }
  let message = ''
  try {
    migrateSnapshotToCurrent(raw, { source: 'backup' })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }

  assert(message.includes('更新版本'), 'future snapshots need an explicit compatibility error')
  assert(raw.schemaVersion === SCHEMA_VERSION + 1, 'rejected input must remain untouched')
}

export function testExplicitTargetRunsEveryRegisteredStepWithoutMutatingSource(): void {
  const raw = { schemaVersion: 1, values: ['original'] }
  const steps: SnapshotMigrationStep[] = [
    {
      fromVersion: 1,
      toVersion: 2,
      migrate(snapshot) {
        const value = snapshot as typeof raw
        value.values.push('v2')
        return { ...value, schemaVersion: 2 }
      },
    },
    {
      fromVersion: 2,
      toVersion: 3,
      migrate(snapshot) {
        const value = snapshot as typeof raw
        value.values.push('v3')
        return { ...value, schemaVersion: 3 }
      },
    },
  ]

  const result = migrateSnapshot(raw, { source: 'json' }, 3, steps)
  const migrated = result.snapshot as typeof raw

  assert(result.fromVersion === 1 && result.toVersion === 3, 'every version step should run')
  assert(result.didChange, 'an explicit upgrade should report a change')
  assert(migrated.values.join(',') === 'original,v2,v3', 'steps should execute in order')
  assert(raw.values.join(',') === 'original', 'migration must protect the source object')
}

export function testHistoricalV3SnapshotNormalizesKnownFieldsAndPreservesUnknownData(): void {
  const raw = {
    trades: [historicalTrade({
      tradeKind: 'practice',
      marker: { keep: true },
    })],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: {},
    futureOptionalField: ['must-survive'],
  }

  const result = migrateSnapshotToCurrent(raw, {
    source: 'library',
    manifestSchemaVersion: 3,
  })
  const snapshot = result.snapshot as unknown as typeof raw & {
    trades: Array<typeof raw.trades[number] & { reviewStatus?: string; mistakeTags?: string[] }>
  }

  assert(result.fromVersion === 3 && result.toVersion === SCHEMA_VERSION, 'v3 must reach current schema')
  assert(snapshot.trades[0]?.tradeKind === 'paper', 'legacy practice trades must become paper trades')
  assert(snapshot.trades[0]?.reviewStatus === 'unreviewed', 'v4 to v5 must add review status when missing')
  assert(Array.isArray(snapshot.trades[0]?.mistakeTags), 'v4 to v5 must add mistake tags when missing')
  assert(
    (snapshot.trades[0]?.marker as { keep?: boolean } | undefined)?.keep === true,
    'unknown nested trade data must survive migration',
  )
  assert(snapshot.futureOptionalField[0] === 'must-survive', 'unknown snapshot fields must survive migration')
  assert(raw.trades[0]?.tradeKind === 'practice', 'historical source objects must remain untouched')
}

export function testManifestV5WithCurrentV6DialectUsesIdempotentCompatibilityStep(): void {
  const raw = {
    trades: [historicalTrade({
      id: 'current-dialect',
      reviewStatus: 'reviewed',
      mistakeTags: ['追单'],
      reviewCategory: 'mistake',
    })],
    strategies: [],
    savedTradeViews: [{ id: 'saved', name: '当前视图' }],
    symbolCatalog: ['BTCUSDT'],
  }

  const result = migrateSnapshotToCurrent(raw, {
    source: 'library',
    manifestSchemaVersion: 5,
  })
  const snapshot = result.snapshot as unknown as typeof raw

  assert(result.didChange, 'stale manifest metadata still needs a compatibility migration receipt')
  assert(snapshot.trades[0]?.reviewStatus === 'reviewed', 'existing current fields must not be reset')
  assert(
    (snapshot.trades[0]?.mistakeTags as string[] | undefined)?.[0] === '追单',
    'existing arrays must not be replaced',
  )
  assert(snapshot.savedTradeViews[0]?.id === 'saved', 'later optional fields must remain intact')
  assert(snapshot.symbolCatalog[0] === 'BTCUSDT', 'current dialect extensions must remain intact')
}

export function testKnownExportVersionsMapToTheirProducerSchema(): void {
  const result = migrateSnapshotToCurrent(
    { trades: [], strategies: [] },
    { source: 'json', exportVersion: 6 },
  )
  assert(
    result.fromVersion === 6 && result.toVersion === 7 && result.didChange,
    'export v6 must migrate from producer schema v6 to current v7',
  )

  const current = migrateSnapshotToCurrent(
    { trades: [], strategies: [] },
    { source: 'json', exportVersion: 7 },
  )
  assert(current.fromVersion === 7 && !current.didChange, 'export v7 maps to producer schema v7')

  let message = ''
  try {
    migrateSnapshotToCurrent(
      { trades: [], strategies: [] },
      { source: 'json', exportVersion: 2 },
    )
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('旧版导出'), 'unproven export v1/v2 must require a dedicated decoder')
}

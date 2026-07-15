import { SCHEMA_VERSION, type PersistedSnapshot } from '@/storage/types'
import { migrateV6ToV7 } from '@/storage/migrations/v6ToV7'

export type MigrationSource = 'library' | 'json' | 'journal-zip' | 'backup'

export interface MigrationContext {
  source: MigrationSource
  manifestSchemaVersion?: number
  exportVersion?: number
}

export interface SnapshotMigrationResult<TSnapshot = unknown> {
  snapshot: TSnapshot
  fromVersion: number
  toVersion: number
  didChange: boolean
}

export interface SnapshotMigrationStep {
  fromVersion: number
  toVersion: number
  migrate(snapshot: unknown, context: MigrationContext): unknown
}

type UnknownRecord = Record<string, unknown>

const EXPORT_PRODUCER_SCHEMA = new Map<number, number>([
  [3, 3],
  [4, 4],
  [5, 5],
  [6, 6],
  [7, 7],
])

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function advanceEmbeddedVersion(snapshot: unknown, toVersion: number): unknown {
  const record = asRecord(snapshot)
  if (record && Object.prototype.hasOwnProperty.call(record, 'schemaVersion')) {
    record.schemaVersion = toVersion
  }
  return snapshot
}

function mapTradeRecords(
  snapshot: unknown,
  transform: (trade: UnknownRecord) => void,
): unknown {
  const record = asRecord(snapshot)
  if (!record || !Array.isArray(record.trades)) return snapshot
  for (const value of record.trades) {
    const trade = asRecord(value)
    if (trade) transform(trade)
  }
  return snapshot
}

function normalizeLegacyTradeKind(value: unknown): unknown {
  return value === 'practice' ? 'paper' : value
}

const ACTIVE_MIGRATIONS: readonly SnapshotMigrationStep[] = [
  {
    fromVersion: 3,
    toVersion: 4,
    migrate(snapshot) {
      mapTradeRecords(snapshot, (trade) => {
        trade.tradeKind = normalizeLegacyTradeKind(trade.tradeKind)
        if (!Array.isArray(trade.activities)) return
        for (const value of trade.activities) {
          const activity = asRecord(value)
          if (!activity) continue
          activity.fromTradeKind = normalizeLegacyTradeKind(activity.fromTradeKind)
          activity.toTradeKind = normalizeLegacyTradeKind(activity.toTradeKind)
        }
      })
      return advanceEmbeddedVersion(snapshot, 4)
    },
  },
  {
    fromVersion: 4,
    toVersion: 5,
    migrate(snapshot) {
      mapTradeRecords(snapshot, (trade) => {
        if (trade.reviewStatus === undefined) trade.reviewStatus = 'unreviewed'
        if (trade.mistakeTags === undefined) trade.mistakeTags = []
        if (trade.reviewCategory === undefined) trade.reviewCategory = 'normal'
      })
      return advanceEmbeddedVersion(snapshot, 5)
    },
  },
  {
    fromVersion: 5,
    toVersion: 6,
    migrate(snapshot) {
      return advanceEmbeddedVersion(snapshot, 6)
    },
  },
  {
    fromVersion: 6,
    toVersion: 7,
    migrate(snapshot) {
      return migrateV6ToV7(snapshot as PersistedSnapshot).snapshot
    },
  },
]

function embeddedSchemaVersion(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as { schemaVersion?: unknown }
  if (Object.prototype.hasOwnProperty.call(record, 'schemaVersion') &&
    (!Number.isInteger(record.schemaVersion) || Number(record.schemaVersion) < 1)) {
    throw new Error('快照 schemaVersion 格式无效')
  }
  const version = record.schemaVersion
  return Number.isInteger(version) && Number(version) > 0 ? Number(version) : null
}

function detectSourceVersion(raw: unknown, context: MigrationContext): number {
  const embedded = embeddedSchemaVersion(raw)
  const manifest =
    Number.isInteger(context.manifestSchemaVersion) &&
    Number(context.manifestSchemaVersion) > 0
      ? Number(context.manifestSchemaVersion)
      : null
  let exported: number | null = null
  if (context.exportVersion !== undefined) {
    if (!Number.isInteger(context.exportVersion) || context.exportVersion < 1) {
      throw new Error(`无效的导出版本：${context.exportVersion}`)
    }
    if (context.exportVersion <= 2) {
      throw new Error(`旧版导出 v${context.exportVersion} 需要专用兼容解码器`)
    }
    exported = EXPORT_PRODUCER_SCHEMA.get(context.exportVersion) ?? null
    if (exported === null) {
      throw new Error(`尚不支持导出版本 v${context.exportVersion}`)
    }
  }

  const detected = [embedded, manifest, exported].filter(
    (version): version is number => version !== null,
  )
  if (new Set(detected).size > 1) {
    throw new Error(`快照、资料库清单或导出文件的版本不一致`)
  }
  if (detected.length > 0) return detected[0]!
  throw new Error(`无法识别 ${context.source} 快照的数据版本`)
}

export function migrateSnapshotToCurrent(
  raw: unknown,
  context: MigrationContext,
): SnapshotMigrationResult<PersistedSnapshot> {
  return migrateSnapshot(
    raw,
    context,
    SCHEMA_VERSION,
    ACTIVE_MIGRATIONS,
  ) as SnapshotMigrationResult<PersistedSnapshot>
}

export function migrateSnapshot(
  raw: unknown,
  context: MigrationContext,
  targetVersion = SCHEMA_VERSION,
  steps: readonly SnapshotMigrationStep[] = ACTIVE_MIGRATIONS,
): SnapshotMigrationResult {
  const fromVersion = detectSourceVersion(raw, context)
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new Error(`无效的目标数据版本：${targetVersion}`)
  }
  if (fromVersion > targetVersion) {
    throw new Error(
      `该数据来自更新版本（v${fromVersion}），当前仅支持至 v${targetVersion}`,
    )
  }
  if (fromVersion === targetVersion) {
    return {
      snapshot: raw,
      fromVersion,
      toVersion: targetVersion,
      didChange: false,
    }
  }

  const bySourceVersion = new Map<number, SnapshotMigrationStep>()
  for (const step of steps) {
    if (step.toVersion !== step.fromVersion + 1) {
      throw new Error(`迁移步骤必须逐版本执行：v${step.fromVersion} → v${step.toVersion}`)
    }
    if (bySourceVersion.has(step.fromVersion)) {
      throw new Error(`v${step.fromVersion} 存在重复迁移步骤`)
    }
    bySourceVersion.set(step.fromVersion, step)
  }

  let version = fromVersion
  let snapshot = structuredClone(raw)
  while (version < targetVersion) {
    const step = bySourceVersion.get(version)
    if (!step) throw new Error(`尚未注册 v${version} → v${version + 1} 的迁移`)
    snapshot = step.migrate(snapshot, context)
    version = step.toVersion
  }

  const finalRecord = asRecord(snapshot)
  if (finalRecord) finalRecord.schemaVersion = targetVersion

  return {
    snapshot,
    fromVersion,
    toVersion: targetVersion,
    didChange: true,
  }
}

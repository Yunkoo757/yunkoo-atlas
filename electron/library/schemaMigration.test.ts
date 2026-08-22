import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import { createFullPersistedSnapshotFixture } from '../../src/storage/fixtures/fullPersistedSnapshot'
import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { LibraryStorage } from './storage'
import {
  migrateOpenedLibraryV8ToV9,
  SCHEMA_MIGRATION_MARKER_FILE,
  SCHEMA_MIGRATION_RECOVERY_DIRECTORY,
} from './schemaMigration'
import { getLibraryPaths } from './paths'

type CrashBoundary =
  | 'before-database-replace'
  | 'after-database-replace'
  | 'after-manifest-replace'

interface V8LibraryFixture {
  path: string
  originalDatabase: Buffer
  originalManifest: Buffer
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function sqlRuntime() {
  return initSqlJs({
    locateFile: (file) => path.resolve('node_modules/sql.js/dist', file),
  })
}

function v8Snapshot() {
  const snapshot = createFullPersistedSnapshotFixture() as unknown as Record<string, unknown>
  delete snapshot.weeklyRiskPreparations
  delete snapshot.riskPolicyVersions
  delete snapshot.monthlyRiskLimits
  delete snapshot.riskOverrideEvents
  const trades = snapshot.trades as Array<Record<string, unknown>>
  delete trades[0]!.closedTradingDayKey
  return snapshot
}

async function createV8LibraryFixture(): Promise<V8LibraryFixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-schema-v8-'))
  const storage = new LibraryStorage(root)
  await storage.open()
  storage.release()

  const SQL = await sqlRuntime()
  const dbFile = path.join(root, 'journal.db')
  const db = new SQL.Database(fs.readFileSync(dbFile))
  try {
    db.run(
      `INSERT INTO meta (key, value) VALUES ('snapshot', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify(v8Snapshot())],
    )
    db.run("DELETE FROM meta WHERE key = 'schemaVersion'")
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
  } finally {
    db.close()
  }

  const manifestFile = path.join(root, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>
  manifest.schemaVersion = 8
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
  return {
    path: root,
    originalDatabase: fs.readFileSync(dbFile),
    originalManifest: fs.readFileSync(manifestFile),
  }
}

async function createV9LibraryFixture(): Promise<V8LibraryFixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-schema-v9-'))
  const storage = new LibraryStorage(root)
  await storage.open()
  storage.release()
  const dbFile = path.join(root, 'journal.db')
  const SQL = await sqlRuntime()
  const db = new SQL.Database(fs.readFileSync(dbFile))
  try {
    const snapshot = createFullPersistedSnapshotFixture() as unknown as Record<string, unknown>
    stripV12StageFields(snapshot)
    delete snapshot.livePerformanceCycles
    db.run("INSERT INTO meta (key, value) VALUES ('snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(snapshot)])
    db.run("INSERT INTO meta (key, value) VALUES ('schemaVersion', '9') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
  } finally {
    db.close()
  }
  const manifestFile = path.join(root, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>
  manifest.schemaVersion = 9
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
  return { path: root, originalDatabase: fs.readFileSync(dbFile), originalManifest: fs.readFileSync(manifestFile) }
}

async function createV10LibraryFixture(): Promise<V8LibraryFixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-schema-v10-'))
  const storage = new LibraryStorage(root)
  await storage.open()
  storage.release()
  const dbFile = path.join(root, 'journal.db')
  const SQL = await sqlRuntime()
  const db = new SQL.Database(fs.readFileSync(dbFile))
  try {
    const snapshot = createFullPersistedSnapshotFixture() as unknown as Record<string, unknown>
    const profile = { ...(snapshot.profile as Record<string, unknown>) }
    delete profile.legacyCashCurrencyAssumption
    snapshot.profile = profile
    const trades = snapshot.trades as Array<Record<string, unknown>>
    delete trades[0]!.cashCurrency
    db.run("INSERT INTO meta (key, value) VALUES ('snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(snapshot)])
    db.run("INSERT INTO meta (key, value) VALUES ('schemaVersion', '10') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
  } finally {
    db.close()
  }
  const manifestFile = path.join(root, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>
  manifest.schemaVersion = 10
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
  return { path: root, originalDatabase: fs.readFileSync(dbFile), originalManifest: fs.readFileSync(manifestFile) }
}

function stripV12StageFields(snapshot: Record<string, unknown>): void {
  delete snapshot.liveStages
  delete snapshot.currentLiveStageId
  delete snapshot.scheduledStageRollover
  for (const trade of snapshot.trades as Array<Record<string, unknown>>) delete trade.liveStageId
  for (const review of snapshot.weeklyReviews as Array<Record<string, unknown>>) delete review.liveStageId
  for (const field of ['weeklyRiskPreparations', 'riskPolicyVersions', 'monthlyRiskLimits', 'riskOverrideEvents']) {
    for (const entity of snapshot[field] as Array<Record<string, unknown>>) delete entity.liveStageId
  }
}

async function createV11LibraryFixture(options: {
  withoutLegacyBoundary?: boolean
  normalizedNameCollisions?: boolean
} = {}): Promise<V8LibraryFixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-schema-v11-'))
  const storage = new LibraryStorage(root)
  await storage.open()
  storage.release()
  const dbFile = path.join(root, 'journal.db')
  const SQL = await sqlRuntime()
  const db = new SQL.Database(fs.readFileSync(dbFile))
  try {
    const snapshot = createFullPersistedSnapshotFixture() as unknown as Record<string, unknown>
    stripV12StageFields(snapshot)
    snapshot.liveStatsStartTradingDayKey = '2026-07-01'
    snapshot.livePerformanceCycles = [
      { id: 'legacy-first', name: '第一阶段', startTradingDayKey: '2026-07-01', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'legacy-second', name: '第二阶段', startTradingDayKey: '2026-07-15', createdAt: '2026-07-15T00:00:00.000Z' },
    ]
    if (options.withoutLegacyBoundary) {
      snapshot.liveStatsStartTradingDayKey = null
      snapshot.livePerformanceCycles = []
      const trade = (snapshot.trades as Array<Record<string, unknown>>)[0]!
      trade.closedAt = '2026-07-17'
      trade.closedTradingDayKey = '2026-07-17'
    }
    if (options.normalizedNameCollisions) {
      snapshot.livePerformanceCycles = [
        { id: 'nfkc-first', name: 'Ａｌｐｈａ', startTradingDayKey: '2026-06-01', createdAt: '2026-06-01T00:00:00.000Z' },
        { id: 'suffix', name: 'alpha (2)', startTradingDayKey: '2026-06-08', createdAt: '2026-06-08T00:00:00.000Z' },
        { id: 'trim', name: '  alpha  ', startTradingDayKey: '2026-06-15', createdAt: '2026-06-15T00:00:00.000Z' },
        { id: 'case', name: 'Alpha', startTradingDayKey: '2026-06-22', createdAt: '2026-06-22T00:00:00.000Z' },
      ]
    }
    db.run("INSERT INTO meta (key, value) VALUES ('snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(snapshot)])
    db.run("INSERT INTO meta (key, value) VALUES ('schemaVersion', '11') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
  } finally {
    db.close()
  }
  const manifestFile = path.join(root, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>
  manifest.schemaVersion = 11
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
  return { path: root, originalDatabase: fs.readFileSync(dbFile), originalManifest: fs.readFileSync(manifestFile) }
}

export async function testNormalV11OpenMigratesCanonicalStageOwnership(): Promise<void> {
  const library = await createV11LibraryFixture({ withoutLegacyBoundary: true })
  try {
    const storage = new LibraryStorage(library.path, {
      allowCreate: false,
      now: () => new Date('2026-08-22T10:00:00.000Z'),
    })
    await storage.open()
    const migrated = storage.loadSnapshot()!
    assert(storage.readManifest().schemaVersion === 12, 'v11 manifest 必须在数据库候选快照验证后升至 v12')
    assert(migrated.liveStages.length === 2, '无旧边界但有历史记录时必须生成更早记录与当前阶段')
    assert(migrated.liveStages[0]?.id === 'legacy-live-stage-1', '更早记录必须获得已知稳定阶段 ID')
    assert(migrated.liveStages[1]?.startsOn === '2026-08-22', '当前阶段必须使用打开时的真实交易日')
    assert(
      migrated.trades[0]?.tradeKind === 'live' && migrated.trades[0].liveStageId === 'legacy-live-stage-1',
      'v11 实盘交易必须获得显式阶段归属',
    )
    storage.release()
  } finally { fs.rmSync(library.path, { recursive: true, force: true }) }
}

export async function testV11OpenDisambiguatesNormalizedStageNamesBeforeV12Validation(): Promise<void> {
  const library = await createV11LibraryFixture({ normalizedNameCollisions: true })
  try {
    const storage = new LibraryStorage(library.path, {
      allowCreate: false,
      now: () => new Date('2026-08-22T10:00:00.000Z'),
    })
    await storage.open()
    const migrated = storage.loadSnapshot()!
    assert(storage.readManifest().schemaVersion === 12, '归一化重名的合法 v11 库必须能完成 v12 schema/open')
    assert(
      migrated.liveStages.map((stage) => stage.name).join('|') ===
        'Ａｌｐｈａ|alpha (2)|alpha (3)|Alpha (4)',
      'Electron 打开 v11 库必须在 v12 校验前稳定消歧阶段名',
    )
    assert(
      migrated.liveStages.map((stage) => stage.id).join(',') ===
        'legacy-live-stage-1,legacy-live-stage-2,legacy-live-stage-3,legacy-live-stage-4' &&
        migrated.currentLiveStageId === 'legacy-live-stage-4',
      'Electron schema 迁移不得因名称消歧改变 ID、顺序或当前指针',
    )
    assert(
      migrated.trades[0]?.tradeKind === 'live' && migrated.trades[0].liveStageId === 'legacy-live-stage-4',
      'Electron schema 名称消歧不得改变实体归属',
    )
    storage.release()
  } finally { fs.rmSync(library.path, { recursive: true, force: true }) }
}

async function assertV11CrashBoundaryRecovers(boundary: Extract<CrashBoundary, 'after-database-replace' | 'after-manifest-replace'>): Promise<void> {
  const library = await createV11LibraryFixture()
  try {
    await assertInjectedCrash(library, boundary)
    const reopened = new LibraryStorage(library.path, { allowCreate: false })
    await reopened.open()
    const pair = await readAndDecodePair(library.path)
    assert(pair.manifest.schemaVersion === 12, `${boundary} 恢复后必须完成 v12 文件对`)
    assert(pair.decodedSchemaVersion === 12, `${boundary} 恢复后 journal.db 必须为 v12`)
    assert(
      pair.snapshot.trades[0]?.tradeKind === 'live' && pair.snapshot.trades[0].liveStageId === 'legacy-live-stage-2',
      `${boundary} 恢复后不得丢失阶段归属`,
    )
    reopened.release()
  } finally { fs.rmSync(library.path, { recursive: true, force: true }) }
}

export async function testV11MigrationRecoversAfterDatabaseReplacement(): Promise<void> {
  await assertV11CrashBoundaryRecovers('after-database-replace')
}

export async function testV11MigrationRecoversAfterManifestReplacement(): Promise<void> {
  await assertV11CrashBoundaryRecovers('after-manifest-replace')
}

export async function testV11ManifestReplacementRecoversDamagedOrMissingDatabaseThenRemigrates(): Promise<void> {
  for (const damage of ['corrupt', 'missing'] as const) {
    const library = await createV11LibraryFixture()
    try {
      await assertInjectedCrash(library, 'after-manifest-replace')
      const dbFile = path.join(library.path, 'journal.db')
      if (damage === 'corrupt') fs.writeFileSync(dbFile, Buffer.from('not-a-sqlite-database'))
      else fs.rmSync(dbFile)

      const reopened = new LibraryStorage(library.path, {
        allowCreate: false,
        now: () => new Date('2026-08-22T10:00:00.000Z'),
      })
      await reopened.open()
      const pair = await readAndDecodePair(library.path)
      assert(pair.manifest.schemaVersion === 12, `${damage} v12 DB 恢复后必须重新迁移 manifest`)
      assert(pair.decodedSchemaVersion === 12, `${damage} v12 DB 恢复后必须重新迁移数据库`)
      assert(
        pair.snapshot.trades[0]?.tradeKind === 'live' && pair.snapshot.trades[0].liveStageId === 'legacy-live-stage-2',
        `${damage} v12 DB 恢复后必须保留已知阶段归属`,
      )
      reopened.release()
    } finally {
      fs.rmSync(library.path, { recursive: true, force: true })
    }
  }
}

export async function testNormalV10OpenAddsNullCurrencyAssumptionWithoutChangingTradeFacts(): Promise<void> {
  const library = await createV10LibraryFixture()
  try {
    const storage = new LibraryStorage(library.path, { allowCreate: false })
    await storage.open()
    const migrated = storage.loadSnapshot()!
    assert(storage.readManifest().schemaVersion === SCHEMA_VERSION, 'v10 桌面库必须迁移到当前 schema')
    assert(migrated.profile?.legacyCashCurrencyAssumption === null, 'v10 桌面库必须补 assumption=null')
    assert(
      !Object.prototype.hasOwnProperty.call(migrated.trades[0]!, 'cashCurrency'),
      'v10 交易缺失币种不得被迁移为 USD',
    )
    storage.release()
  } finally { fs.rmSync(library.path, { recursive: true, force: true }) }
}

export async function testNormalV9OpenMigratesCanonicalStageGraph(): Promise<void> {
  const library = await createV9LibraryFixture()
  try {
    const storage = new LibraryStorage(library.path, { allowCreate: false })
    await storage.open()
    const migrated = storage.loadSnapshot()!
    assert(migrated.liveStages.length > 0, 'v9 打开必须迁移为原生阶段图')
    assert(migrated.liveStages.some((stage) => stage.id === migrated.currentLiveStageId), 'v9 迁移后的当前阶段指针必须有效')
    assert(migrated.liveStages.filter((stage) => stage.status === 'current').length === 1, 'v9 迁移后必须只有一个当前阶段')
    storage.release()
  } finally { fs.rmSync(library.path, { recursive: true, force: true }) }
}

export async function testHistoricalV8ToV9MarkerRecoversThenMigratesToCurrentSchema(): Promise<void> {
  const library = await createV8LibraryFixture()
  const previous = process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY
  process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY = 'after-database-replace'
  try {
    const storage = new LibraryStorage(library.path, { allowCreate: false })
    let crashed = false
    try { await storage.open() } catch { crashed = true } finally { storage.release() }
    assert(crashed, '历史 v8→v9 迁移必须在替换边界可中断')
    const markerPath = path.join(library.path, SCHEMA_MIGRATION_MARKER_FILE)
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Record<string, unknown>
    marker.toVersion = 9
    fs.writeFileSync(markerPath, JSON.stringify(marker), 'utf8')
    if (previous === undefined) delete process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY
    else process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY = previous
    const reopened = new LibraryStorage(library.path, { allowCreate: false })
    await reopened.open()
    assert(reopened.readManifest().schemaVersion === SCHEMA_VERSION, '历史 v8→v9 marker 恢复后必须继续迁移至当前 schema')
    reopened.release()
  } finally {
    if (previous === undefined) delete process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY
    else process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY = previous
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

async function readAndDecodePair(libraryPath: string) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(libraryPath, 'manifest.json'), 'utf8'),
  ) as { schemaVersion: number }
  const SQL = await sqlRuntime()
  const db = new SQL.Database(fs.readFileSync(path.join(libraryPath, 'journal.db')))
  try {
    const rows = db.exec("SELECT key, value FROM meta WHERE key IN ('snapshot', 'schemaVersion')")
    const values = new Map(
      (rows[0]?.values ?? []).map((row) => [String(row[0]), String(row[1])]),
    )
    const snapshotJson = values.get('snapshot')
    assert(snapshotJson !== undefined, 'journal.db 必须包含实际 meta.snapshot')
    const snapshot = decodeCanonicalSnapshot(JSON.parse(snapshotJson), {
      version: manifest.schemaVersion,
      label: 'Electron schema migration test pair',
    })
    return {
      manifest,
      snapshot,
      decodedSchemaVersion: values.has('schemaVersion')
        ? Number(values.get('schemaVersion'))
        : 8,
    }
  } finally {
    db.close()
  }
}

async function assertInjectedCrash(
  library: V8LibraryFixture,
  boundary: CrashBoundary,
): Promise<void> {
  const previous = process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY
  process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY = boundary
  const storage = new LibraryStorage(library.path, { allowCreate: false })
  let injected = false
  try {
    await storage.open()
  } catch (error) {
    injected = error instanceof Error && error.message.includes(`injected crash: ${boundary}`)
  } finally {
    storage.release()
    if (previous === undefined) delete process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY
    else process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY = previous
  }
  assert(injected, `${boundary} 必须在指定文件替换边界模拟不可捕获强杀`)

  const markerFile = path.join(library.path, SCHEMA_MIGRATION_MARKER_FILE)
  const recoveryRoot = path.join(library.path, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)
  assert(fs.lstatSync(markerFile).isFile(), '强杀后必须保留实际迁移 marker 文件')
  assert(
    fs.readFileSync(path.join(recoveryRoot, 'journal.db')).equals(library.originalDatabase),
    '恢复对象必须是原始 journal.db 文件，不得是假造 snapshot sidecar',
  )
  assert(
    fs.readFileSync(path.join(recoveryRoot, 'manifest.json')).equals(library.originalManifest),
    '恢复对象必须是原始 manifest.json 文件',
  )
}

async function assertCrashBoundaryRecovers(boundary: CrashBoundary): Promise<void> {
  const library = await createV8LibraryFixture()
  try {
    await assertInjectedCrash(library, boundary)
    const reopened = new LibraryStorage(library.path, { allowCreate: false })
    try {
      await reopened.open()
      const pair = await readAndDecodePair(library.path)
      assert(
        pair.manifest.schemaVersion === pair.decodedSchemaVersion,
        '恢复后 manifest 与 journal.db 版本必须一致',
      )
      assert(
        [8, SCHEMA_VERSION].includes(pair.manifest.schemaVersion),
        '恢复结果只能是完整 v8 或完整当前 schema 文件对',
      )
      assert(!fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_MARKER_FILE)), '验证完成后必须清理 marker')
      assert(
        !fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)),
        '验证完成后必须清理专用恢复目录',
      )
    } finally {
      reopened.release()
    }
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testMigrationRecoversBeforeDatabaseReplacement(): Promise<void> {
  await assertCrashBoundaryRecovers('before-database-replace')
}

export async function testMigrationRecoversAfterDatabaseReplacement(): Promise<void> {
  await assertCrashBoundaryRecovers('after-database-replace')
}

export async function testMigrationRecoversAfterManifestReplacement(): Promise<void> {
  await assertCrashBoundaryRecovers('after-manifest-replace')
}

export async function testNormalV8OpenMigratesSnapshotAndBackfillsTradingDays(): Promise<void> {
  const library = await createV8LibraryFixture()
  try {
    const SQL = await sqlRuntime()
    const dbFile = path.join(library.path, 'journal.db')
    const db = new SQL.Database(fs.readFileSync(dbFile))
    try {
      const raw = v8Snapshot()
      const trade = (raw.trades as Array<Record<string, unknown>>)[0]!
      raw.display = { ...(raw.display as Record<string, unknown>), tradingDayStartHour: 6 }
      raw.trades = [
        { ...trade, id: 'timestamp-before-start', closedAt: '2026-07-27T05:59:00+08:00' },
        { ...trade, id: 'date-only', closedAt: '2026-07-27' },
        { ...trade, id: 'invalid-date', closedAt: '2026-02-30' },
      ]
      db.run("UPDATE meta SET value = ? WHERE key = 'snapshot'", [JSON.stringify(raw)])
      fs.writeFileSync(dbFile, Buffer.from(db.export()))
    } finally {
      db.close()
    }

    const storage = new LibraryStorage(library.path, { allowCreate: false })
    try {
      await storage.open()
      const pair = await readAndDecodePair(library.path)
      assert(pair.manifest.schemaVersion === SCHEMA_VERSION && pair.decodedSchemaVersion === SCHEMA_VERSION, '普通 v8 open 必须完成当前 schema 文件对迁移')
      assert(pair.snapshot.trades[0]?.closedTradingDayKey === '2026-07-26', '时间戳必须按快照内 6 点边界回填')
      assert(pair.snapshot.trades[1]?.closedTradingDayKey === '2026-07-27', '日期字符串不得二次换日')
      assert(pair.snapshot.trades[2]?.closedTradingDayKey === undefined, '非法日期必须保持缺失')
    } finally {
      storage.release()
    }
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testCaughtMigrationFailureRestoresTheVerifiedV8Pair(): Promise<void> {
  const library = await createV8LibraryFixture()
  const previous = process.env.ATLAS_TEST_SCHEMA_MIGRATION_FAILURE_BOUNDARY
  process.env.ATLAS_TEST_SCHEMA_MIGRATION_FAILURE_BOUNDARY = 'after-database-replace'
  const storage = new LibraryStorage(library.path, { allowCreate: false })
  let rejected = false
  try {
    await storage.open()
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('injected failure')
  } finally {
    if (previous === undefined) delete process.env.ATLAS_TEST_SCHEMA_MIGRATION_FAILURE_BOUNDARY
    else process.env.ATLAS_TEST_SCHEMA_MIGRATION_FAILURE_BOUNDARY = previous
  }
  try {
    assert(rejected, '可捕获迁移失败必须向调用方报告原始失败')
    assert(
      fs.readFileSync(path.join(library.path, 'journal.db')).equals(library.originalDatabase),
      '可捕获失败必须确定性恢复原始 journal.db',
    )
    assert(
      fs.readFileSync(path.join(library.path, 'manifest.json')).equals(library.originalManifest),
      '可捕获失败必须确定性恢复原始 manifest.json',
    )
    assert(!fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_MARKER_FILE)), 'v8 pair 验证后必须清理 marker')
    assert(
      !fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)),
      'v8 pair 验证后必须清理 recovery 目录',
    )

    await storage.open()
    assert(storage.readManifest().schemaVersion === SCHEMA_VERSION, '同一实例重试必须真正重新打开并完成迁移')
    const loaded = storage.loadSnapshot()
    assert(loaded !== null, '同一实例重试后必须可读 snapshot')
    loaded.profile = {
      avatarId: loaded.profile?.avatarId ?? null,
      displayName: 'retry-write-sentinel',
      customAvatarDataUrl: loaded.profile?.customAvatarDataUrl ?? null,
      legacyCashCurrencyAssumption: loaded.profile?.legacyCashCurrencyAssumption ?? null,
    }
    storage.saveSnapshot(loaded)
    storage.release()

    const verified = new LibraryStorage(library.path, { allowCreate: false })
    try {
      await verified.open()
      assert(
        verified.loadSnapshot()?.profile?.displayName === 'retry-write-sentinel',
        '同一实例重试后的写入必须真实持久化',
      )
    } finally {
      verified.release()
    }
  } finally {
    storage.release()
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testManifestReplacedMarkerRestoresV8WhenTheActiveDatabaseIsCorrupt(): Promise<void> {
  const library = await createV8LibraryFixture()
  try {
    await assertInjectedCrash(library, 'after-manifest-replace')
    fs.writeFileSync(path.join(library.path, 'journal.db'), Buffer.from('corrupt database'))
    const reopened = new LibraryStorage(library.path, { allowCreate: false })
    try {
      await reopened.open()
      const pair = await readAndDecodePair(library.path)
      assert(
        pair.manifest.schemaVersion === pair.decodedSchemaVersion,
        '损坏的正式 v9 DB 必须从已验证 v8 文件对恢复后重新迁移',
      )
      assert(pair.snapshot.profile.displayName === '合同用户', '恢复不得丢失原始 v8 snapshot')
    } finally {
      reopened.release()
    }
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testManifestReplacedMarkerRestoresV8WhenRequiredTablesAreMissing(): Promise<void> {
  const library = await createV8LibraryFixture()
  try {
    await assertInjectedCrash(library, 'after-manifest-replace')
    const SQL = await sqlRuntime()
    const dbFile = path.join(library.path, 'journal.db')
    const db = new SQL.Database(fs.readFileSync(dbFile))
    try {
      db.run('DROP TABLE assets')
      fs.writeFileSync(dbFile, Buffer.from(db.export()))
    } finally {
      db.close()
    }
    const reopened = new LibraryStorage(library.path, { allowCreate: false })
    try {
      await reopened.open()
      const pair = await readAndDecodePair(library.path)
      assert(pair.manifest.schemaVersion === SCHEMA_VERSION, '缺少必需表的当前 DB 必须先恢复 v8 再迁移')
    } finally {
      reopened.release()
    }
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testMarkerlessMixedV8ManifestAndV9DatabaseFailsClosed(): Promise<void> {
  const library = await createV8LibraryFixture()
  const SQL = await sqlRuntime()
  const dbFile = path.join(library.path, 'journal.db')
  const db = new SQL.Database(fs.readFileSync(dbFile))
  try {
    db.run("UPDATE meta SET value = ? WHERE key = 'snapshot'", [
      JSON.stringify(createFullPersistedSnapshotFixture()),
    ])
    db.run("INSERT INTO meta (key, value) VALUES ('schemaVersion', '9')")
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
  } finally {
    db.close()
  }
  const mixedDatabase = fs.readFileSync(dbFile)
  const storage = new LibraryStorage(library.path, { allowCreate: false })
  let recoveryError = false
  try {
    await storage.open()
  } catch (error) {
    recoveryError = error instanceof Error && error.message.includes('混合')
  } finally {
    storage.release()
  }
  try {
    assert(recoveryError, '无 marker 的 v8/v9 混合文件对必须进入明确恢复错误')
    assert(fs.readFileSync(dbFile).equals(mixedDatabase), '无 marker 时不得猜测或改写 journal.db')
    assert(
      fs.readFileSync(path.join(library.path, 'manifest.json')).equals(library.originalManifest),
      '无 marker 时不得猜测或改写 manifest.json',
    )
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testPendingV9RecoveryRestoresWhenTheFormalDatabaseIsMissing(): Promise<void> {
  const library = await createV8LibraryFixture()
  try {
    await assertInjectedCrash(library, 'after-manifest-replace')
    fs.rmSync(path.join(library.path, 'journal.db'))
    const reopened = new LibraryStorage(library.path, { allowCreate: false })
    try {
      await reopened.open()
      const pair = await readAndDecodePair(library.path)
      assert(pair.manifest.schemaVersion === SCHEMA_VERSION, '正式 DB 丢失时必须恢复 verified v8 pair 后重迁当前 schema')
      assert(pair.snapshot.profile.displayName === '合同用户', '正式 DB 丢失恢复不得丢失 snapshot')
    } finally {
      reopened.release()
    }
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testExistingV8DatabaseMissingRequiredTableIsNotRepairedBeforeRecoveryPreparation(): Promise<void> {
  const library = await createV8LibraryFixture()
  const SQL = await sqlRuntime()
  const dbFile = path.join(library.path, 'journal.db')
  const db = new SQL.Database(fs.readFileSync(dbFile))
  try {
    db.run('DROP TABLE assets')
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
  } finally {
    db.close()
  }
  const storage = new LibraryStorage(library.path)
  let rejected = false
  try {
    await storage.open()
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('数据表')
  } finally {
    storage.release()
  }
  try {
    assert(rejected, '既有 v8 缺表必须在 recovery preparation 前拒绝，不得内存修补')
    assert(!fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_MARKER_FILE)), '无效 recovery pair 不得写 marker')
    assert(
      !fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)),
      '无效 recovery pair 必须清理未提交 recovery 目录',
    )
    const persisted = new SQL.Database(fs.readFileSync(dbFile))
    try {
      const tables = persisted.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets'")
      assert((tables[0]?.values.length ?? 0) === 0, '拒绝后不得把 CREATE IF NOT EXISTS 修补落盘')
    } finally {
      persisted.close()
    }
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testCleanupFailureKeepsMarkerAndAllowsSameInstanceRetry(): Promise<void> {
  const library = await createV8LibraryFixture()
  const previous = process.env.ATLAS_TEST_SCHEMA_MIGRATION_CLEANUP_FAILURE_BOUNDARY
  process.env.ATLAS_TEST_SCHEMA_MIGRATION_CLEANUP_FAILURE_BOUNDARY = 'before-marker-delete'
  const storage = new LibraryStorage(library.path, { allowCreate: false })
  let rejected = false
  try {
    await storage.open()
  } catch {
    rejected = true
  } finally {
    if (previous === undefined) delete process.env.ATLAS_TEST_SCHEMA_MIGRATION_CLEANUP_FAILURE_BOUNDARY
    else process.env.ATLAS_TEST_SCHEMA_MIGRATION_CLEANUP_FAILURE_BOUNDARY = previous
  }
  try {
    assert(rejected, 'cleanup 注入失败必须向 open 调用方报告')
    assert(fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_MARKER_FILE)), 'cleanup 失败时 marker 必须最后保留')
    assert(
      !fs.existsSync(path.join(library.path, '.v8-to-v9-journal.db.candidate')),
      'marker 删除前 candidate 应已先清理',
    )
    assert(
      !fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)),
      'marker 删除前 recovery 应已先清理',
    )

    await storage.open()
    assert(storage.readManifest().schemaVersion === SCHEMA_VERSION, '同实例重试必须完成 pending cleanup')
    const loaded = storage.loadSnapshot()
    assert(loaded !== null, 'cleanup 重试后必须可读 snapshot')
    loaded.profile = {
      avatarId: loaded.profile?.avatarId ?? null,
      displayName: 'cleanup-retry-write',
      customAvatarDataUrl: loaded.profile?.customAvatarDataUrl ?? null,
      legacyCashCurrencyAssumption: loaded.profile?.legacyCashCurrencyAssumption ?? null,
    }
    storage.saveSnapshot(loaded)
    assert(storage.loadSnapshot()?.profile?.displayName === 'cleanup-retry-write', 'cleanup 重试后必须可读写')
  } finally {
    storage.release()
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testPendingV9RecoveryRestoresAfterFormalDatabaseReadFailure(): Promise<void> {
  const library = await createV8LibraryFixture()
  try {
    await assertInjectedCrash(library, 'after-manifest-replace')
    let failNextRead = true
    const storage = new LibraryStorage(library.path, {
      allowCreate: false,
      readDatabaseFile(filePath: string) {
        if (failNextRead) {
          failNextRead = false
          throw new Error('injected formal database read failure')
        }
        return fs.readFileSync(filePath)
      },
    })
    try {
      await storage.open()
      assert(!failNextRead, 'pending-v9 正式路径必须经过可失败的 readFile 边界')
      assert(storage.readManifest().schemaVersion === SCHEMA_VERSION, '正式 DB 读取失败必须恢复 v8 后重迁')
      assert(storage.loadSnapshot()?.profile?.displayName === '合同用户', '读取失败恢复必须保留数据')
    } finally {
      storage.release()
    }
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testPendingV9RecoveryRestoresAfterSqlDatabaseConstructorFailure(): Promise<void> {
  const library = await createV8LibraryFixture()
  try {
    await assertInjectedCrash(library, 'after-manifest-replace')
    let failNextConstruction = true
    const storage = new LibraryStorage(library.path, {
      allowCreate: false,
      createDatabase(
        DatabaseClass: new (data?: ArrayLike<number> | null) => Database,
        data?: ArrayLike<number> | null,
      ) {
        if (failNextConstruction) {
          failNextConstruction = false
          throw new Error('injected SQL Database constructor failure')
        }
        return new DatabaseClass(data)
      },
    })
    try {
      await storage.open()
      assert(!failNextConstruction, 'pending-v9 正式路径必须经过可失败的 SQL constructor 边界')
      assert(storage.readManifest().schemaVersion === SCHEMA_VERSION, 'SQL constructor 失败必须恢复 v8 后重迁')
      assert(storage.loadSnapshot()?.profile?.displayName === '合同用户', 'constructor 失败恢复必须保留数据')
    } finally {
      storage.release()
    }
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testRollbackCleanupFailureRetriesFromTheVerifiedActiveV8Pair(): Promise<void> {
  const library = await createV8LibraryFixture()
  const previousFailure = process.env.ATLAS_TEST_SCHEMA_MIGRATION_FAILURE_BOUNDARY
  const previousCleanup = process.env.ATLAS_TEST_SCHEMA_MIGRATION_CLEANUP_FAILURE_BOUNDARY
  process.env.ATLAS_TEST_SCHEMA_MIGRATION_FAILURE_BOUNDARY = 'after-database-replace'
  process.env.ATLAS_TEST_SCHEMA_MIGRATION_CLEANUP_FAILURE_BOUNDARY = 'before-marker-delete'
  const storage = new LibraryStorage(library.path, { allowCreate: false })
  let rejected = false
  try {
    await storage.open()
  } catch {
    rejected = true
  } finally {
    if (previousFailure === undefined) delete process.env.ATLAS_TEST_SCHEMA_MIGRATION_FAILURE_BOUNDARY
    else process.env.ATLAS_TEST_SCHEMA_MIGRATION_FAILURE_BOUNDARY = previousFailure
    if (previousCleanup === undefined) delete process.env.ATLAS_TEST_SCHEMA_MIGRATION_CLEANUP_FAILURE_BOUNDARY
    else process.env.ATLAS_TEST_SCHEMA_MIGRATION_CLEANUP_FAILURE_BOUNDARY = previousCleanup
  }
  try {
    assert(rejected, '回滚后的 cleanup 失败必须报告给调用方')
    assert(fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_MARKER_FILE)), '回滚 cleanup 失败必须保留 marker')
    assert(
      !fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)),
      'marker-last cleanup 允许 recovery 已先删除',
    )
    assert(fs.readFileSync(path.join(library.path, 'journal.db')).equals(library.originalDatabase), '正式 DB 必须已恢复为原始 v8')
    assert(fs.readFileSync(path.join(library.path, 'manifest.json')).equals(library.originalManifest), '正式 manifest 必须已恢复为原始 v8')

    await storage.open()
    assert(storage.readManifest().schemaVersion === SCHEMA_VERSION, '同实例重试必须识别 verified active v8 pair 并完成迁移')
    const loaded = storage.loadSnapshot()
    assert(loaded !== null, '回滚 cleanup 重试后必须可读')
    loaded.profile = {
      avatarId: loaded.profile?.avatarId ?? null,
      displayName: 'rollback-cleanup-retry-write',
      customAvatarDataUrl: loaded.profile?.customAvatarDataUrl ?? null,
      legacyCashCurrencyAssumption: loaded.profile?.legacyCashCurrencyAssumption ?? null,
    }
    storage.saveSnapshot(loaded)
    assert(storage.loadSnapshot()?.profile?.displayName === 'rollback-cleanup-retry-write', '回滚 cleanup 重试后必须可写')
  } finally {
    storage.release()
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

async function assertInvalidRecoveryPreparationRejected(
  corruptFormalDatabase: (SQL: Awaited<ReturnType<typeof sqlRuntime>>, dbFile: string) => void,
): Promise<void> {
  const library = await createV8LibraryFixture()
  const SQL = await sqlRuntime()
  const dbFile = path.join(library.path, 'journal.db')
  const openedV8 = new SQL.Database(fs.readFileSync(dbFile))
  const manifest = JSON.parse(fs.readFileSync(path.join(library.path, 'manifest.json'), 'utf8'))
  corruptFormalDatabase(SQL, dbFile)
  let rejected = false
  try {
    migrateOpenedLibraryV8ToV9({
      db: openedV8,
      paths: getLibraryPaths(library.path),
      manifest,
      now: new Date('2026-08-22T10:00:00.000Z'),
    })
  } catch {
    rejected = true
  } finally {
    openedV8.close()
  }
  try {
    assert(rejected, '磁盘 recovery pair SQL 重开验证失败时必须拒绝迁移')
    assert(!fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_MARKER_FILE)), 'recovery SQL 验证前不得写 marker')
    assert(
      !fs.existsSync(path.join(library.path, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)),
      'recovery SQL 验证失败必须清理未提交副本',
    )
  } finally {
    fs.rmSync(library.path, { recursive: true, force: true })
  }
}

export async function testRecoveryPreparationRejectsDatabaseMissingRequiredTableBeforeMarker(): Promise<void> {
  await assertInvalidRecoveryPreparationRejected((SQL, dbFile) => {
    const damaged = new SQL.Database(fs.readFileSync(dbFile))
    try {
      damaged.run('DROP TABLE assets')
      fs.writeFileSync(dbFile, Buffer.from(damaged.export()))
    } finally {
      damaged.close()
    }
  })
}

export async function testRecoveryPreparationRejectsCorruptDatabaseBeforeMarker(): Promise<void> {
  await assertInvalidRecoveryPreparationRejected((_SQL, dbFile) => {
    fs.writeFileSync(dbFile, Buffer.from('corrupt recovery database'))
  })
}

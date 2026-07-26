import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { createFullPersistedSnapshotFixture } from '../../src/storage/fixtures/fullPersistedSnapshot'
import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { LibraryStorage } from './storage'
import {
  SCHEMA_MIGRATION_MARKER_FILE,
  SCHEMA_MIGRATION_RECOVERY_DIRECTORY,
} from './schemaMigration'

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
        [8, 9].includes(pair.manifest.schemaVersion),
        '恢复结果只能是完整 v8 或完整 v9 文件对',
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
      assert(pair.manifest.schemaVersion === 9 && pair.decodedSchemaVersion === 9, '普通 v8 open 必须完成 v9 文件对迁移')
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
    storage.release()
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
  } finally {
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
      assert(pair.manifest.schemaVersion === 9, '缺少必需表的 v9 DB 必须先恢复 v8 再迁移')
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

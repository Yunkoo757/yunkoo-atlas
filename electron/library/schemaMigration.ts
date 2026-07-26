import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Database } from 'sql.js'
import type { LibraryManifest } from '../../src/storage/types'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { fsyncDirectorySync, writeFileAtomicallySync } from './atomicFile'
import type { getLibraryPaths } from './paths'

type LibraryPaths = ReturnType<typeof getLibraryPaths>
type MigrationPhase = 'prepared' | 'database-replaced' | 'manifest-replaced'
type DatabaseConstructor = new (data?: ArrayLike<number> | null) => Database

export const SCHEMA_MIGRATION_MARKER_FILE = 'v8-to-v9.migration'
export const SCHEMA_MIGRATION_RECOVERY_DIRECTORY = '.v8-to-v9-recovery'

const CANDIDATE_DATABASE_FILE = '.v8-to-v9-journal.db.candidate'
const SNAPSHOT_KEY = 'snapshot'
const DATABASE_SCHEMA_KEY = 'schemaVersion'

export interface SchemaMigrationMarker {
  version: 1
  fromVersion: 8
  toVersion: 9
  phase: MigrationPhase
  recoveryDirectory: typeof SCHEMA_MIGRATION_RECOVERY_DIRECTORY
  databaseSha256: string
  manifestSha256: string
}

export type RecoveryResult =
  | { kind: 'none' }
  | { kind: 'restored-v8' }
  | { kind: 'pending-v9-validation'; marker: SchemaMigrationMarker }

function markerPath(paths: LibraryPaths): string {
  return path.join(paths.root, SCHEMA_MIGRATION_MARKER_FILE)
}

function recoveryRoot(paths: LibraryPaths): string {
  return path.join(paths.root, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)
}

function candidateDatabasePath(paths: LibraryPaths): string {
  return path.join(paths.root, CANDIDATE_DATABASE_FILE)
}

function assertDirectLibraryChild(paths: LibraryPaths, target: string, expectedName: string): void {
  const resolvedRoot = path.resolve(paths.root)
  const resolvedTarget = path.resolve(target)
  if (path.dirname(resolvedTarget) !== resolvedRoot || path.basename(resolvedTarget) !== expectedName) {
    throw new Error('Schema 迁移清理路径越出当前 library，已停止操作')
  }
}

function assertRegularFile(filePath: string, label: string): void {
  const stat = fs.lstatSync(filePath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} 必须是普通文件`)
}

function checksum(filePath: string): string {
  assertRegularFile(filePath, 'Schema 迁移文件')
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function readManifestFile(paths: LibraryPaths): LibraryManifest {
  assertRegularFile(paths.manifestFile, 'manifest.json')
  const value: unknown = JSON.parse(fs.readFileSync(paths.manifestFile, 'utf8'))
  if (
    typeof value !== 'object' ||
    value === null ||
    !Number.isInteger((value as LibraryManifest).schemaVersion) ||
    typeof (value as LibraryManifest).libraryId !== 'string'
  ) {
    throw new Error('Schema 迁移发现 manifest.json 格式无效')
  }
  return value as LibraryManifest
}

function readMigrationMarker(paths: LibraryPaths): SchemaMigrationMarker | null {
  const filePath = markerPath(paths)
  if (!fs.existsSync(filePath)) return null
  assertDirectLibraryChild(paths, filePath, SCHEMA_MIGRATION_MARKER_FILE)
  assertRegularFile(filePath, 'Schema 迁移 marker')
  const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const marker = value as Partial<SchemaMigrationMarker>
  if (
    typeof value !== 'object' ||
    value === null ||
    marker.version !== 1 ||
    marker.fromVersion !== 8 ||
    marker.toVersion !== 9 ||
    !['prepared', 'database-replaced', 'manifest-replaced'].includes(String(marker.phase)) ||
    marker.recoveryDirectory !== SCHEMA_MIGRATION_RECOVERY_DIRECTORY ||
    typeof marker.databaseSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(marker.databaseSha256) ||
    typeof marker.manifestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(marker.manifestSha256)
  ) {
    throw new Error('Schema 迁移 marker 无效，已停止自动恢复')
  }
  return marker as SchemaMigrationMarker
}

function writeMigrationMarker(paths: LibraryPaths, marker: SchemaMigrationMarker): void {
  const filePath = markerPath(paths)
  assertDirectLibraryChild(paths, filePath, SCHEMA_MIGRATION_MARKER_FILE)
  writeFileAtomicallySync(filePath, JSON.stringify(marker, null, 2), 'utf8')
}

function fsyncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'r+')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function copyRecoveryPair(paths: LibraryPaths): SchemaMigrationMarker {
  assertRegularFile(paths.dbFile, 'journal.db')
  const manifest = readManifestFile(paths)
  if (manifest.schemaVersion !== 8) throw new Error('只有 v8 Electron library 可以准备 v9 迁移')

  const directory = recoveryRoot(paths)
  assertDirectLibraryChild(paths, directory, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)
  if (fs.existsSync(directory)) removeRecoveryDirectory(paths)
  fs.mkdirSync(directory)
  const recoveryDatabase = path.join(directory, 'journal.db')
  const recoveryManifest = path.join(directory, 'manifest.json')
  fs.copyFileSync(paths.dbFile, recoveryDatabase, fs.constants.COPYFILE_EXCL)
  fs.copyFileSync(paths.manifestFile, recoveryManifest, fs.constants.COPYFILE_EXCL)
  fsyncFile(recoveryDatabase)
  fsyncFile(recoveryManifest)
  fsyncDirectorySync(directory)

  const marker: SchemaMigrationMarker = {
    version: 1,
    fromVersion: 8,
    toVersion: 9,
    phase: 'prepared',
    recoveryDirectory: SCHEMA_MIGRATION_RECOVERY_DIRECTORY,
    databaseSha256: checksum(recoveryDatabase),
    manifestSha256: checksum(recoveryManifest),
  }
  if (
    marker.databaseSha256 !== checksum(paths.dbFile) ||
    marker.manifestSha256 !== checksum(paths.manifestFile)
  ) {
    throw new Error('Schema v8 恢复副本校验失败')
  }
  return marker
}

function recoveryFiles(paths: LibraryPaths, marker: SchemaMigrationMarker) {
  if (marker.recoveryDirectory !== SCHEMA_MIGRATION_RECOVERY_DIRECTORY) {
    throw new Error('Schema 迁移恢复目录无效')
  }
  const directory = recoveryRoot(paths)
  assertDirectLibraryChild(paths, directory, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)
  const stat = fs.lstatSync(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Schema 迁移恢复目录必须是当前 library 内的普通目录')
  }
  const database = path.join(directory, 'journal.db')
  const manifest = path.join(directory, 'manifest.json')
  if (checksum(database) !== marker.databaseSha256 || checksum(manifest) !== marker.manifestSha256) {
    throw new Error('Schema 迁移恢复文件 checksum 无效，已停止恢复')
  }
  const recoveryManifest = JSON.parse(fs.readFileSync(manifest, 'utf8')) as LibraryManifest
  if (recoveryManifest.schemaVersion !== 8) throw new Error('Schema 迁移恢复 manifest 不是 v8')
  return { database, manifest }
}

export function restoreVerifiedV8Pair(paths: LibraryPaths, marker: SchemaMigrationMarker): void {
  const recovery = recoveryFiles(paths, marker)
  writeFileAtomicallySync(paths.dbFile, fs.readFileSync(recovery.database))
  writeFileAtomicallySync(paths.manifestFile, fs.readFileSync(recovery.manifest))
  if (
    checksum(paths.dbFile) !== marker.databaseSha256 ||
    checksum(paths.manifestFile) !== marker.manifestSha256 ||
    readManifestFile(paths).schemaVersion !== 8
  ) {
    throw new Error('Schema v8 文件对恢复后校验失败')
  }
}

function removeRecoveryDirectory(paths: LibraryPaths): void {
  const directory = recoveryRoot(paths)
  assertDirectLibraryChild(paths, directory, SCHEMA_MIGRATION_RECOVERY_DIRECTORY)
  if (!fs.existsSync(directory)) return
  const stat = fs.lstatSync(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('拒绝递归删除非普通 Schema 迁移恢复目录')
  }
  fs.rmSync(directory, { recursive: true, force: true })
}

function removeCandidateDatabase(paths: LibraryPaths): void {
  const filePath = candidateDatabasePath(paths)
  assertDirectLibraryChild(paths, filePath, CANDIDATE_DATABASE_FILE)
  if (!fs.existsSync(filePath)) return
  assertRegularFile(filePath, 'Schema 迁移候选数据库')
  fs.rmSync(filePath)
}

export function removeMigrationRecovery(
  paths: LibraryPaths,
  _marker: SchemaMigrationMarker,
): void {
  const filePath = markerPath(paths)
  assertDirectLibraryChild(paths, filePath, SCHEMA_MIGRATION_MARKER_FILE)
  fs.rmSync(filePath, { force: true })
  fsyncDirectorySync(paths.root)
  removeRecoveryDirectory(paths)
  removeCandidateDatabase(paths)
}

export function recoverInterruptedSchemaMigrationFiles(paths: LibraryPaths): RecoveryResult {
  const marker = readMigrationMarker(paths)
  if (!marker) return { kind: 'none' }

  if (marker.phase === 'manifest-replaced') {
    try {
      if (readManifestFile(paths).schemaVersion === 9) {
        return { kind: 'pending-v9-validation', marker }
      }
    } catch {
      // 正式 v9 pair 不能在 SQL 初始化前证明完整，任何清单异常都确定性恢复 v8。
    }
  }

  restoreVerifiedV8Pair(paths, marker)
  removeMigrationRecovery(paths, marker)
  return { kind: 'restored-v8' }
}

function readSnapshot(db: Database): unknown | null {
  const statement = db.prepare('SELECT value FROM meta WHERE key = ?')
  try {
    statement.bind([SNAPSHOT_KEY])
    return statement.step() ? JSON.parse(String(statement.getAsObject().value)) : null
  } finally {
    statement.free()
  }
}

function readDatabaseSchemaVersion(db: Database, snapshot: unknown): number | null {
  const statement = db.prepare('SELECT value FROM meta WHERE key = ?')
  try {
    statement.bind([DATABASE_SCHEMA_KEY])
    if (statement.step()) {
      const version = Number(statement.getAsObject().value)
      if (!Number.isInteger(version)) throw new Error('journal.db 的 schemaVersion 无效')
      return version
    }
  } finally {
    statement.free()
  }
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null
  const record = snapshot as Record<string, unknown>
  const v9Fields = [
    'weeklyRiskPreparations',
    'riskPolicyVersions',
    'monthlyRiskLimits',
    'riskOverrideEvents',
  ]
  return v9Fields.every((field) => Object.prototype.hasOwnProperty.call(record, field)) ? 9 : 8
}

function assertDatabaseStructure(db: Database): void {
  const integrity = db.exec('PRAGMA integrity_check')
  if (String(integrity[0]?.values[0]?.[0]).toLowerCase() !== 'ok') {
    throw new Error('journal.db integrity_check 失败')
  }
  const tables = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'assets')",
  )
  const names = new Set((tables[0]?.values ?? []).map((row) => String(row[0])))
  if (!names.has('meta') || !names.has('assets')) {
    throw new Error('journal.db 缺少 Schema 迁移所需数据表')
  }
  const requiredColumns: Record<string, string[]> = {
    meta: ['key', 'value'],
    assets: ['id', 'mime', 'file_name', 'byte_size', 'created_at'],
  }
  for (const [table, required] of Object.entries(requiredColumns)) {
    const columns = new Set(
      (db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1])),
    )
    if (required.some((column) => !columns.has(column))) {
      throw new Error(`journal.db 的 ${table} 表结构不完整`)
    }
  }
}

export function assertOpenedPairVersion(
  db: Database,
  manifest: LibraryManifest,
  expectedVersion: number,
  options: { requireSnapshot?: boolean } = {},
): void {
  assertDatabaseStructure(db)
  if (manifest.schemaVersion !== expectedVersion) {
    throw new Error(
      `Electron library 恢复错误：manifest v${manifest.schemaVersion} 与预期 v${expectedVersion} 不一致`,
    )
  }
  const snapshot = readSnapshot(db)
  if (snapshot === null) {
    if (options.requireSnapshot) throw new Error('v8 Electron library 缺少 meta.snapshot，无法迁移')
    return
  }
  const databaseVersion = readDatabaseSchemaVersion(db, snapshot)
  if (databaseVersion !== expectedVersion) {
    throw new Error(
      `Electron library 恢复错误：journal.db v${databaseVersion ?? 'unknown'} 与 manifest v${manifest.schemaVersion} 混合`,
    )
  }
  decodeCanonicalSnapshot(snapshot, {
    version: expectedVersion,
    label: `Electron library v${expectedVersion} snapshot`,
  })
}

function databaseConstructor(db: Database): DatabaseConstructor {
  return db.constructor as unknown as DatabaseConstructor
}

function openAndValidateDatabase(
  DatabaseClass: DatabaseConstructor,
  databaseFile: string,
  manifest: LibraryManifest,
  expectedVersion: number,
): Database {
  const opened = new DatabaseClass(fs.readFileSync(databaseFile))
  try {
    assertOpenedPairVersion(opened, manifest, expectedVersion, { requireSnapshot: true })
    return opened
  } catch (error) {
    opened.close()
    throw error
  }
}

function injectCrash(boundary: string): void {
  if (process.env.ATLAS_TEST_SCHEMA_MIGRATION_CRASH_BOUNDARY !== boundary) return
  const error = new Error(`injected crash: ${boundary}`) as Error & { schemaMigrationCrash?: boolean }
  error.schemaMigrationCrash = true
  throw error
}

function injectFailure(boundary: string): void {
  if (process.env.ATLAS_TEST_SCHEMA_MIGRATION_FAILURE_BOUNDARY === boundary) {
    throw new Error(`injected failure: ${boundary}`)
  }
}

function pauseForForcedKillEvidence(boundary: string): void {
  if (
    process.env.TRADER_ATLAS_FORCED_KILL_MODE === 'verify' &&
    process.env.ATLAS_SCHEMA_MIGRATION_PAUSE_BOUNDARY === boundary
  ) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000)
  }
}

function isInjectedCrash(error: unknown): boolean {
  return error instanceof Error &&
    (error as Error & { schemaMigrationCrash?: boolean }).schemaMigrationCrash === true
}

export function migrateOpenedLibraryV8ToV9(input: {
  db: Database
  paths: LibraryPaths
  manifest: LibraryManifest
}): void {
  if (SCHEMA_VERSION !== 9) throw new Error('Electron v8 迁移协议只支持目标 schema v9')
  assertOpenedPairVersion(input.db, input.manifest, 8, { requireSnapshot: true })

  const DatabaseClass = databaseConstructor(input.db)
  let marker: SchemaMigrationMarker | null = null
  let candidate: Database | null = null
  try {
    marker = copyRecoveryPair(input.paths)
    writeMigrationMarker(input.paths, marker)

    const rawSnapshot = readSnapshot(input.db)
    if (rawSnapshot === null) throw new Error('v8 Electron library 缺少 meta.snapshot，无法迁移')
    const canonical = decodeCanonicalSnapshot(rawSnapshot, {
      version: 8,
      label: 'Electron v8 migration snapshot',
    })
    candidate = new DatabaseClass(input.db.export())
    candidate.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SNAPSHOT_KEY, JSON.stringify(canonical)],
    )
    candidate.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [DATABASE_SCHEMA_KEY, String(SCHEMA_VERSION)],
    )
    const candidateBytes = Buffer.from(candidate.export())
    writeFileAtomicallySync(candidateDatabasePath(input.paths), candidateBytes)
    const v9Manifest = { ...input.manifest, schemaVersion: SCHEMA_VERSION }
    const checkedCandidate = openAndValidateDatabase(
      DatabaseClass,
      candidateDatabasePath(input.paths),
      v9Manifest,
      SCHEMA_VERSION,
    )
    checkedCandidate.close()

    injectCrash('before-database-replace')
    pauseForForcedKillEvidence('before-database-replace')
    writeFileAtomicallySync(input.paths.dbFile, candidateBytes)
    marker = { ...marker, phase: 'database-replaced' }
    writeMigrationMarker(input.paths, marker)
    injectCrash('after-database-replace')
    injectFailure('after-database-replace')
    pauseForForcedKillEvidence('after-database-replace')

    writeFileAtomicallySync(
      input.paths.manifestFile,
      JSON.stringify(v9Manifest, null, 2),
      'utf8',
    )
    marker = { ...marker, phase: 'manifest-replaced' }
    writeMigrationMarker(input.paths, marker)
    injectCrash('after-manifest-replace')
    pauseForForcedKillEvidence('after-manifest-replace')

    const verified = openAndValidateDatabase(
      DatabaseClass,
      input.paths.dbFile,
      readManifestFile(input.paths),
      SCHEMA_VERSION,
    )
    verified.close()
    removeMigrationRecovery(input.paths, marker)
  } catch (error) {
    if (isInjectedCrash(error)) throw error
    if (marker !== null) {
      restoreVerifiedV8Pair(input.paths, marker)
      const restored = openAndValidateDatabase(
        DatabaseClass,
        input.paths.dbFile,
        readManifestFile(input.paths),
        8,
      )
      restored.close()
      removeMigrationRecovery(input.paths, marker)
    } else {
      removeRecoveryDirectory(input.paths)
      removeCandidateDatabase(input.paths)
    }
    throw error
  } finally {
    candidate?.close()
  }
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import type { PersistedSnapshot } from '../../src/storage/types'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { LibraryStorage } from './storage'
import { currentTestSnapshot } from './testSnapshot'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function currentSnapshot(): PersistedSnapshot {
  return currentTestSnapshot({ tagPresets: ['raw-load'] })
}

export async function testRawSnapshotIncludesManifestVersionWithoutChangingSavePath(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-raw-snapshot-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(currentSnapshot())

    const loaded = storage.loadRawSnapshot()

    assert(loaded !== null, '已保存的资料库必须返回原始快照')
    assert(
      loaded?.manifestSchemaVersion === SCHEMA_VERSION,
      '原始快照必须携带同一次资料库读取对应的 manifest 版本',
    )
    assert(
      (loaded?.snapshot as PersistedSnapshot).tagPresets?.[0] === 'raw-load',
      '原始读取不得改变已保存的数据',
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testRawSnapshotDoesNotRunCurrentStructureValidation(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-unvalidated-raw-snapshot-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(currentSnapshot())
    storage.release()

    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules/sql.js/dist', file),
    })
    const dbFile = path.join(root, 'journal.db')
    const db = new SQL.Database(fs.readFileSync(dbFile))
    const structurallyInvalid = { ...currentSnapshot(), trades: [{ id: 'legacy-opaque' }] }
    db.run('UPDATE meta SET value = ? WHERE key = ?', [JSON.stringify(structurallyInvalid), 'snapshot'])
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
    db.close()

    await storage.open()
    const loaded = storage.loadRawSnapshot()
    assert(
      (loaded?.snapshot as { trades?: Array<{ id?: string }> }).trades?.[0]?.id === 'legacy-opaque',
      'raw load 必须允许迁移器先读取尚未通过当前结构校验的旧数据',
    )

    let rejected = false
    try {
      storage.loadSnapshot()
    } catch {
      rejected = true
    }
    assert(rejected, '普通主进程读取仍不得绕过当前结构校验')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testLegacySnapshotMigrationCommitsValidatedV7Atomically(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-migration-commit-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(currentSnapshot())
    storage.release()

    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules/sql.js/dist', file),
    })
    const dbFile = path.join(root, 'journal.db')
    const db = new SQL.Database(fs.readFileSync(dbFile))
    const legacySnapshot: PersistedSnapshot = {
      trades: [],
      strategies: [],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
      tagPresets: ['legacy-v6'],
    }
    db.run('UPDATE meta SET value = ? WHERE key = ?', [JSON.stringify(legacySnapshot), 'snapshot'])
    fs.writeFileSync(dbFile, Buffer.from(db.export()))
    db.close()

    const manifestPath = path.join(root, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 6 }))

    await storage.open()
    const loaded = storage.loadSnapshot()
    assert(loaded !== null, '旧清单下的快照必须可以迁移读取')
    const committedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    assert(committedManifest.schemaVersion === 7, '验证通过后必须提交 v7 manifest')
    const raw = storage.loadRawSnapshot()?.snapshot as { schemaVersion?: number }
    assert(raw.schemaVersion === 7, 'v7 快照与 manifest 必须作为同一次升级提交')
    assert(loaded?.tagPresets?.[0] === 'legacy-v6', '升级不得丢失旧快照可选字段')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

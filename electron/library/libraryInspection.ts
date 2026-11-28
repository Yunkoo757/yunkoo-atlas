import fs from 'node:fs'
import path from 'node:path'
import { readDatabaseSnapshotRevision, resolveSnapshotVersion, validateLibraryAssetIndex } from '../../src/storage/libraryDatabase'
import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { collectAssetIdsFromSnapshot } from '../../src/storage/snapshotRichText'
import { SCHEMA_VERSION, type PersistedSnapshot } from '../../src/storage/types'
import { readCompatibleLibraryManifest } from './libraryIdentity'
import type { getLibraryPaths } from './paths'
import { getLibrarySql } from './sqliteRuntime'

export class LibraryInspectionError extends Error {
  constructor(readonly part: 'database' | 'attachments', message: string) {
    super(message)
  }
}

export interface LibraryDatabaseInspection {
  tradeCount: number
  strategyCount: number
  assets: { id: string; mime: string; fileName: string; byteSize: number }[]
  referencedAssetIds: string[]
}

export async function validateLibraryDatabaseFile(
  dbFile: string,
  options: { allowEmptySnapshot?: boolean; schemaVersion?: number } = {},
): Promise<LibraryDatabaseInspection> {
  const SQL = await getLibrarySql()
  let db: InstanceType<typeof SQL.Database> | null = null
  try {
    db = new SQL.Database(fs.readFileSync(dbFile))
    const integrity = db.exec('PRAGMA integrity_check')
    const integrityRows = integrity[0]?.values ?? []
    if (integrityRows.length !== 1 || String(integrityRows[0]?.[0]).toLowerCase() !== 'ok') {
      throw new Error('database integrity_check failed')
    }
    const tables = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'assets')",
    )
    const names = new Set((tables[0]?.values ?? []).map((row) => String(row[0])))
    if (!names.has('meta') || !names.has('assets')) {
      throw new Error('database is missing required tables')
    }

    readDatabaseSnapshotRevision(db)
    const snapshotRows = db.exec("SELECT value FROM meta WHERE key = 'snapshot'")
    const snapshotText = snapshotRows[0]?.values[0]?.[0]
    let snapshot: PersistedSnapshot | null = null
    if (snapshotText == null) {
      if (!options.allowEmptySnapshot) throw new Error('database snapshot is missing')
    } else {
      const parsed: unknown = JSON.parse(String(snapshotText))
      const versionRows = db.exec("SELECT value FROM meta WHERE key = 'schemaVersion'")
      const storedVersion = versionRows[0]?.values[0]?.[0]
      snapshot = decodeCanonicalSnapshot(parsed, {
        version: resolveSnapshotVersion(parsed, storedVersion == null ? null : Number(storedVersion), options.schemaVersion ?? SCHEMA_VERSION),
        label: 'database snapshot',
      })
    }

    const referencedAssetIds = snapshot ? collectAssetIdsFromSnapshot(snapshot) : []

    const assetRows = db.exec('SELECT id, mime, file_name, byte_size FROM assets')
    const assets = (assetRows[0]?.values ?? []).map((row) => ({
      id: String(row[0] ?? ''),
      mime: String(row[1] ?? ''),
      fileName: String(row[2] ?? ''),
      byteSize: Number(row[3]),
    }))
    const assetIds = validateLibraryAssetIndex(assets)
    if (!snapshot && assets.length > 0) {
      throw new Error('empty database contains orphaned assets')
    }
    for (const asset of assets) {
      if (!asset.mime || !Number.isFinite(asset.byteSize) || asset.byteSize < 0) {
        throw new Error('asset metadata is invalid')
      }
    }
    for (const referencedId of referencedAssetIds) {
      if (!assetIds.has(referencedId)) {
        throw new Error(`snapshot references a missing asset (${referencedId})`)
      }
    }
    return {
      tradeCount: snapshot?.trades.length ?? 0,
      strategyCount: snapshot?.strategies.length ?? 0,
      assets,
      referencedAssetIds,
    }
  } catch (err) {
    throw new LibraryInspectionError(
      'database', `journal.db could not be validated (${err instanceof Error ? err.message : String(err)})`,
    )
  } finally {
    db?.close()
  }
}

export async function validateDesktopLibrary(
  paths: ReturnType<typeof getLibraryPaths>,
  options: { allowEmptySnapshot?: boolean } = {},
): Promise<LibraryDatabaseInspection> {
  const manifest = readCompatibleLibraryManifest(paths.manifestFile)
  const inspection = await validateLibraryDatabaseFile(paths.dbFile, {
    ...options,
    schemaVersion: manifest.schemaVersion,
  })
  const expectedAssets = new Map(inspection.assets.map((asset) => [asset.fileName, asset]))
  const actualFileNames: string[] = []

  if (fs.existsSync(paths.attachments)) {
    const attachmentsStat = fs.lstatSync(paths.attachments)
    if (attachmentsStat.isSymbolicLink() || !attachmentsStat.isDirectory()) {
      throw new LibraryInspectionError('attachments', 'attachments must be a regular directory')
    }
    actualFileNames.push(...fs.readdirSync(paths.attachments))
  }

  for (const fileName of actualFileNames) {
    const filePath = path.join(paths.attachments, fileName)
    const fileStat = fs.lstatSync(filePath)
    if (fileStat.isSymbolicLink()) {
      throw new LibraryInspectionError('attachments', `attachment must not be a symbolic link (${fileName})`)
    }
    if (!fileStat.isFile()) {
      throw new LibraryInspectionError('attachments', `attachment must be a regular file (${fileName})`)
    }
    const asset = expectedAssets.get(fileName)
    if (!asset) {
      throw new LibraryInspectionError('attachments', `unexpected attachment (${fileName})`)
    }
    if (fileStat.size !== asset.byteSize) {
      throw new LibraryInspectionError('attachments', `attachment is missing or incomplete (${fileName})`)
    }
    expectedAssets.delete(fileName)
  }

  const missingFileName = expectedAssets.keys().next().value as string | undefined
  if (missingFileName) {
    throw new LibraryInspectionError('attachments', `attachment is missing or incomplete (${missingFileName})`)
  }
  return inspection
}

import type { Database } from 'sql.js'
import { stripRetiredSnapshotDomains } from '../../src/storage/retiredSnapshotDomains'

export type SnapshotDatabaseConstructor = new (data?: ArrayLike<number> | null) => Database

/** Change only a caller-owned SQL candidate; schema, revision and attachment metadata stay intact. */
export function stripRetiredSnapshotDomainsInDatabase(database: Database): boolean {
  const snapshotRows = database.exec("SELECT value FROM meta WHERE key = 'snapshot'")
  const snapshotText = snapshotRows[0]?.values[0]?.[0]
  if (snapshotText === undefined || snapshotText === null) return false
  const raw: unknown = JSON.parse(String(snapshotText))
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const cleaned = JSON.stringify(stripRetiredSnapshotDomains(raw))
  if (cleaned === JSON.stringify(raw)) return false
  database.run("UPDATE meta SET value = ? WHERE key = 'snapshot'", [cleaned])
  return true
}

/** Preserve exact original bytes when there is nothing to retire. Never edits the input database file. */
export function retiredSnapshotDatabaseBytes(bytes: Buffer, DatabaseClass: SnapshotDatabaseConstructor): Buffer {
  const candidate = new DatabaseClass(Buffer.from(bytes))
  try {
    return stripRetiredSnapshotDomainsInDatabase(candidate) ? Buffer.from(candidate.export()) : bytes
  } finally {
    candidate.close()
  }
}

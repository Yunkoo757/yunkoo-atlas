import fs from 'node:fs'
import type { PersistedSnapshot } from '../src/storage/types'
import { LibraryStorage } from '../electron/library/storage'

function counts(snapshot: Pick<PersistedSnapshot, 'trades' | 'strategies'>) {
  return { trades: snapshot.trades.length, strategies: snapshot.strategies.length }
}

export async function runUpgrade(root: string) {
  const first = new LibraryStorage(root)
  await first.open()
  const before = first.loadRawSnapshot()
  if (!before) throw new Error('Copied library has no snapshot')
  const source = before.snapshot as { trades?: unknown[]; strategies?: unknown[] }
  const beforeCounts = {
    trades: source.trades?.length ?? 0,
    strategies: source.strategies?.length ?? 0,
  }
  const migrated = first.loadSnapshot()
  if (!migrated) throw new Error('Migration returned no snapshot')
  const manifest = first.readManifest()
  first.close()

  const second = new LibraryStorage(root)
  await second.open()
  const reopened = second.loadSnapshot()
  second.close()
  if (!reopened) throw new Error('Reopened migrated library has no snapshot')

  return {
    fromVersion: before.manifestSchemaVersion,
    toVersion: manifest.schemaVersion,
    beforeCounts,
    afterCounts: counts(migrated),
    reopenedCounts: counts(reopened),
    pendingRecoveryArtifacts: fs.readdirSync(root).filter((name) => name.startsWith('.upgrade-')),
  }
}

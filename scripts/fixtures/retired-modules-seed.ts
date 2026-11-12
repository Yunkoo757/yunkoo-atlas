import { createFullPersistedSnapshotFixture, FULL_SNAPSHOT_ASSET_IDS } from '../../src/storage/fixtures/fullPersistedSnapshot'
import { LibraryStorage } from '../../electron/library/storage'
import type { PersistedSnapshot } from '../../src/storage/types'
import initSqlJs from 'sql.js'
import fs from 'node:fs'
import path from 'node:path'

/** Create an actual old on-disk snapshot before Electron starts, in the caller-owned temporary directory. */
export async function seedRetiredNativeLibrary(
  library: string,
  legacy: PersistedSnapshot,
  assets: Array<{ id: string; mime: string; data: string }>,
) {
  const storage = new LibraryStorage(library)
  try {
    await storage.open()
    for (const asset of assets) storage.importAsset(asset.id, asset.mime, Buffer.from(asset.data, 'base64'))
    storage.saveSnapshot(legacy)
  } finally {
    storage.release()
  }
  const SQL = await initSqlJs({ locateFile: file => path.resolve('node_modules/sql.js/dist', file) })
  const databaseFile = path.join(library, 'journal.db')
  const db = new SQL.Database(fs.readFileSync(databaseFile))
  try {
    db.run("UPDATE meta SET value = ? WHERE key = 'snapshot'", [JSON.stringify(legacy)])
    fs.writeFileSync(databaseFile, Buffer.from(db.export()))
  } finally {
    db.close()
  }
}

/** Synthetic data only. Old feature keys are deliberately malformed: retirement must not depend on their engine. */
export function createRetiredModulesSeed() {
  const snapshot = createFullPersistedSnapshotFixture()
  const original = snapshot.trades[0]
  snapshot.trades = Array.from({ length: 16 }, (_, index) => ({
    ...original,
    id: index === 0 ? original.id : `retirement-qa-${index}`,
    ref: `${index === 1 ? 'CASE' : 'TRD'}-REMOVE-${index + 1}`,
    tradeKind: index === 1 ? 'case' as const : 'live' as const,
    symbol: index % 2 ? 'XAUUSD' : 'BTCUSDT',
    note: `<p>隔离验收：交易正文与复盘保留 ${index + 1}</p><img src="journal-asset://${FULL_SNAPSHOT_ASSET_IDS.shared}">`,
  }))
  snapshot.profile = { ...snapshot.profile!, displayName: '隔离验收 · 模块移除' }
  snapshot.starredIds = [snapshot.trades[0].id]
  snapshot.subscribedIds = []
  snapshot.display = { ...snapshot.display, hideClosed: false, sidebarPrimaryOrder: ['judgmentDesk', 'reviewComposer', 'trades', 'dashboard', 'weeklyReview', 'reviewCases', 'reviewSession'] as never }
  snapshot.shortcuts = {
    'global.commandPalette': { mod: true, key: 'k' },
    'nav.judgmentDesk': { key: 'j' },
    'nav.reviewComposer': { key: 'r' },
    'judgment.yes': { key: '1' },
  }
  const legacy = { ...snapshot,
    judgmentDesk: { deliberatelyInvalid: true, samples: [{ images: [{ assetId: 'retired-only-image' }] }] },
    reviewComposer: { deliberatelyInvalid: true, draft: { text: '退役草稿不应再出现' } },
  }
  return { legacy, assetIds: [...Object.values(FULL_SNAPSHOT_ASSET_IDS), 'retired-only-image'], firstTradeId: snapshot.trades[0].id }
}

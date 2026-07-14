import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import type { PersistedSnapshot } from '../../src/storage/types'
import { LibraryStorage } from './storage'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function snapshot(label: string): PersistedSnapshot {
  return {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    tagPresets: [label],
  }
}

function snapshotWithAsset(label: string, assetId: string): PersistedSnapshot {
  return {
    ...snapshot(label),
    trades: [{
      id: `trade-${label}`,
      ref: `TRD-${label}`,
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'open',
      conviction: 'medium',
      strategyId: 'strategy-1',
      tradeKind: 'live',
      tags: [],
      mistakeTags: [],
      reviewStatus: 'unreviewed',
      reviewCategory: 'normal',
      entry: 100,
      exit: null,
      size: 1,
      pnl: null,
      rMultiple: null,
      openedAt: '2026-07-14',
      closedAt: null,
      note: `<img src="journal-asset://${assetId}">`,
    }],
  }
}

export async function testImportCommitReplacesSnapshotAndAssetsTogether(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-commit-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    await storage.commitImport(snapshot('new'), [{
      id: 'fresh-asset',
      mime: 'image/png',
      buffer: Buffer.from('new-image'),
    }])

    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'new', 'the final snapshot should commit')
    assert(
      Buffer.from(storage.getAssetBytes('fresh-asset')?.bytes ?? []).equals(Buffer.from('new-image')),
      'the staged attachment should become visible with the same commit',
    )
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testImportCommitFailureKeepsExistingLibraryUntouched(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-rollback-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    storage.importAsset('same-id', 'image/png', Buffer.from('old-image'))

    let rejected = false
    try {
      await storage.commitImport(snapshot('new'), [{
        id: 'same-id',
        mime: 'image/png',
        buffer: Buffer.from('different-image'),
      }])
    } catch {
      rejected = true
    }

    assert(rejected, 'same-id different bytes must abort the import')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'old', 'a failed import must preserve the old snapshot')
    assert(
      Buffer.from(storage.getAssetBytes('same-id')?.bytes ?? []).equals(Buffer.from('old-image')),
      'a failed import must preserve existing attachment bytes',
    )
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testTenAssetImportFailureMidBatchLeavesNoOrphanFiles(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-mid-batch-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(snapshot('old'))
    storage.importAsset('asset-6', 'image/png', Buffer.from('existing-sixth-image'))

    const batch = Array.from({ length: 10 }, (_, index) => ({
      id: `asset-${index + 1}`,
      mime: 'image/png',
      buffer: Buffer.from(`new-image-${index + 1}`),
    }))
    let rejected = false
    try {
      await storage.commitImport(snapshot('new'), batch)
    } catch {
      rejected = true
    }

    assert(rejected, '第 6 张附件冲突必须中止整批导入')
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'old', '中途失败不得提交新快照')
    for (let index = 1; index <= 5; index += 1) {
      assert(storage.getAssetBytes(`asset-${index}`) === null, `不得遗留第 ${index} 张孤儿附件`)
    }
    assert(
      Buffer.from(storage.getAssetBytes('asset-6')?.bytes ?? []).equals(Buffer.from('existing-sixth-image')),
      '冲突附件的原始字节必须保持不变',
    )
    for (let index = 7; index <= 10; index += 1) {
      assert(storage.getAssetBytes(`asset-${index}`) === null, `失败后不得写入第 ${index} 张附件`)
    }
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testCompensatingImportRemovesOnlyUnreferencedBatchAssets(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-import-compensation-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.importAsset('existing-asset', 'image/png', Buffer.from('existing-image'))
    const imported = { id: 'batch-asset', mime: 'image/png', buffer: Buffer.from('batch-image') }
    await storage.commitImport(snapshotWithAsset('imported', imported.id), [imported])
    assert(storage.getAssetBytes(imported.id) !== null, '首个原子提交必须保存被快照引用的附件')

    await storage.commitImport(snapshot('local'), [imported], { pruneUnreferenced: true })
    assert(storage.loadSnapshot()?.tagPresets?.[0] === 'local', '补偿提交必须恢复本地快照')
    assert(storage.getAssetBytes(imported.id) === null, '补偿提交必须删除本批已失去引用的附件')
    assert(storage.getAssetBytes('existing-asset') !== null, '补偿不得删除本批以外的既有附件')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

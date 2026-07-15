import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import type { PersistedSnapshot } from '../../src/storage/types'
import { SCHEMA_VERSION } from '../../src/storage/types'
import type { JournalBridge } from '../../src/types/journal-bridge'
import { ElectronStorageAdapter } from '../../src/storage/electronAdapter'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function currentSnapshot(): PersistedSnapshot {
  return {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    tagPresets: ['renderer-migrated'],
  }
}

async function withJournalBridge<T>(bridge: Partial<JournalBridge>, run: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { journalBridge: { isElectron: true, ...bridge } },
  })
  try {
    return await run()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete (globalThis as { window?: unknown }).window
  }
}

export async function testElectronAdapterLoadsThroughRawMigrationBoundary(): Promise<void> {
  const snapshot = currentSnapshot()
  await withJournalBridge({
    loadRawSnapshot: async () => ({
      snapshot,
      manifestSchemaVersion: SCHEMA_VERSION,
    }),
    loadSnapshot: async () => {
      throw new Error('renderer must not use the legacy validated IPC path')
    },
  }, async () => {
    const loaded = await new ElectronStorageAdapter().loadSnapshot()
    assert(loaded?.tagPresets?.[0] === 'renderer-migrated', 'renderer 应返回迁移并校验后的当前快照')
  })
}

export async function testElectronAdapterMigratesLegacyRawSnapshotBeforeValidation(): Promise<void> {
  const legacySnapshot = {
    trades: [{
      id: 'legacy-trade',
      ref: 'TRD-1',
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'win',
      conviction: 'medium',
      strategyId: 'legacy-strategy',
      tradeKind: 'practice',
      tags: [],
      entry: 100,
      exit: 110,
      size: 1,
      pnl: 10,
      rMultiple: 1,
      openedAt: '2026-01-01',
      closedAt: '2026-01-02',
      note: '',
    }],
    strategies: [{
      id: 'legacy-strategy',
      name: 'Legacy',
      icon: 'target',
      color: '#5e6ad2',
    }],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }
  await withJournalBridge({
    loadRawSnapshot: async () => ({ snapshot: legacySnapshot, manifestSchemaVersion: 3 }),
  }, async () => {
    const loaded = await new ElectronStorageAdapter().loadSnapshot()
    assert(loaded?.trades[0]?.tradeKind === 'paper', 'v3 practice 必须经迁移转为 paper')
    assert(loaded?.trades[0]?.reviewStatus === 'unreviewed', 'v4 旧交易必须补齐当前复盘状态')
    assert(Array.isArray(loaded?.trades[0]?.mistakeTags), 'v4 旧交易必须补齐错误标签数组')
  })
}

export async function testElectronAdapterRejectsFutureLibraryBeforeHydration(): Promise<void> {
  let message = ''
  await withJournalBridge({
    loadRawSnapshot: async () => ({
      snapshot: currentSnapshot(),
      manifestSchemaVersion: SCHEMA_VERSION + 1,
    }),
  }, async () => {
    try {
      await new ElectronStorageAdapter().loadSnapshot()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
  })
  assert(message.includes('更新版本'), '未来版本资料库必须在 hydrate 前给出明确拒绝')
}

export async function testElectronAdapterRejectsDamagedCurrentSnapshot(): Promise<void> {
  let message = ''
  await withJournalBridge({
    loadRawSnapshot: async () => ({
      snapshot: { ...currentSnapshot(), trades: [{ id: 'broken' }] },
      manifestSchemaVersion: SCHEMA_VERSION,
    }),
  }, async () => {
    try {
      await new ElectronStorageAdapter().loadSnapshot()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
  })
  assert(message.includes('invalid trade'), '结构损坏的当前快照必须在 hydrate 前拒绝')
}

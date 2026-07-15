import type { PersistedSnapshot } from '../../src/storage/types'
import type { JournalBridge } from '../../src/types/journal-bridge'
import { ElectronStorageAdapter } from '../../src/storage/electronAdapter'
import { currentTestSnapshot } from './testSnapshot'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function currentSnapshot(): PersistedSnapshot {
  return currentTestSnapshot({ tagPresets: ['main-validated'] })
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

export async function testElectronAdapterUsesMainProcessValidatedLoadBoundary(): Promise<void> {
  const snapshot = currentSnapshot()
  await withJournalBridge({
    loadRawSnapshot: async () => {
      throw new Error('renderer must not bypass the recoverable main-process upgrade path')
    },
    loadSnapshot: async () => snapshot,
  }, async () => {
    const loaded = await new ElectronStorageAdapter().loadSnapshot()
    assert(loaded?.tagPresets?.[0] === 'main-validated', 'renderer 应接收主进程迁移并校验后的当前快照')
  })
}

export async function testElectronAdapterPropagatesMainProcessUpgradeFailure(): Promise<void> {
  let message = ''
  await withJournalBridge({
    loadSnapshot: async () => {
      throw new Error('资料库升级未完成，已恢复升级前数据')
    },
  }, async () => {
    try {
      await new ElectronStorageAdapter().loadSnapshot()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
  })
  assert(message.includes('已恢复升级前数据'), '主进程恢复失败必须原样反馈给 renderer')
}

export async function testElectronAdapterRejectsFutureLibraryBeforeHydration(): Promise<void> {
  let message = ''
  await withJournalBridge({
    loadSnapshot: async () => { throw new Error('该数据来自更新版本（v8）') },
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
    loadSnapshot: async () => { throw new Error('Stored library snapshot has invalid trade') },
  }, async () => {
    try {
      await new ElectronStorageAdapter().loadSnapshot()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
  })
  assert(message.includes('invalid trade'), '结构损坏的当前快照必须在 hydrate 前拒绝')
}

import assert from 'node:assert/strict'
import type { StorageAdapter } from './adapter'
import type { PersistedSnapshot } from './types'
import { LEGACY_LOCAL_STORAGE_KEY } from './legacyIdentity'
import { migrateFromLocalStorageIfNeeded } from './migrate'

async function isolatedLegacy(raw: string | null, run: (context: {
  adapter: StorageAdapter
  saved: PersistedSnapshot[]
  legacy: Map<string, string>
}) => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const legacy = new Map<string, string>()
  if (raw !== null) legacy.set(LEGACY_LOCAL_STORAGE_KEY, raw)
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => legacy.get(key) ?? null,
    removeItem: (key: string) => { legacy.delete(key) },
  } })
  const saved: PersistedSnapshot[] = []
  const adapter = {
    loadSnapshot: async () => null,
    saveSnapshot: async (value: PersistedSnapshot) => { saved.push(value) },
    saveAsset: async () => { assert.fail('验证失败前不能写入附件') },
  } as unknown as StorageAdapter
  try { await run({ adapter, saved, legacy }) } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

export async function testInvalidLegacyDataIsPreservedWithoutSeedingOrWriting() {
  for (const raw of ['{broken', '', 'null', '{}', '{"state":{"trades":"invalid"}}']) {
    await isolatedLegacy(raw, async ({ adapter, saved, legacy }) => {
      await assert.rejects(migrateFromLocalStorageIfNeeded(adapter), /旧版|legacy|资料|格式|解析/i)
      assert.equal(saved.length, 0, '无效旧资料不能被替换为默认种子快照')
      assert.equal(legacy.get(LEGACY_LOCAL_STORAGE_KEY), raw, '必须逐字保留原始资料供恢复')
    })
  }
}

export async function testAbsentLegacyDataStillInitializesTheDefaultSnapshot() {
  await isolatedLegacy(null, async ({ adapter, saved }) => {
    assert.equal(await migrateFromLocalStorageIfNeeded(adapter), true)
    assert.equal(saved.length, 1)
  })
}

export async function testValidLegacyDataRemainsWhenTheDestinationSaveFails() {
  const raw = '{"state":{"trades":[],"strategies":[]}}'
  await isolatedLegacy(raw, async ({ adapter, legacy }) => {
    adapter.saveSnapshot = async () => { throw new Error('disk unavailable') }
    await assert.rejects(migrateFromLocalStorageIfNeeded(adapter), /disk unavailable/)
    assert.equal(legacy.get(LEGACY_LOCAL_STORAGE_KEY), raw)
  })
}

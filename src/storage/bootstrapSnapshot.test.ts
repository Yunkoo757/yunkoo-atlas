import type { StorageAdapter } from '@/storage/adapter'
import { loadBootstrapSnapshot } from '@/storage/bootstrap'
import { ElectronStorageAdapter } from '@/storage/electronAdapter'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

class MemoryAdapter implements StorageAdapter {
  loads = 0
  saves = 0
  opens = 0
  onSave?: (snapshot: PersistedSnapshot) => PersistedSnapshot

  constructor(public snapshot: PersistedSnapshot | null) {}
  async open(): Promise<void> { this.opens += 1 }
  async getManifest(): Promise<LibraryManifest> { throw new Error('此夹具不应读取 manifest') }
  async loadSnapshot(): Promise<PersistedSnapshot | null> { this.loads += 1; return this.snapshot }
  async saveSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    this.saves += 1
    this.snapshot = this.onSave ? this.onSave(snapshot) : snapshot
  }
  async saveAsset(): Promise<string> { throw new Error('此夹具不应写附件') }
  async getAssetObjectUrl(): Promise<string | null> { return null }
  async getAssetForExport(): Promise<ExportAssetRecord | null> { return null }
  async getAssetStats() { return { count: 0, totalBytes: 0, missingCount: 0 } }
  async importAssets(): Promise<void> {}
  async commitImport(): Promise<void> { throw new Error('此夹具不应提交导入') }
}

async function withElectronBridge<T>(
  storage: MemoryAdapter,
  run: (adapter: ElectronStorageAdapter) => Promise<T>,
): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { journalBridge: {
      isElectron: true,
      storageOpen: () => storage.open(),
      loadSnapshot: () => storage.loadSnapshot(),
      saveSnapshot: (snapshot: PersistedSnapshot) => storage.saveSnapshot(snapshot),
      importAssets: () => storage.importAssets(),
    } },
  })
  try {
    const adapter = new ElectronStorageAdapter()
    await adapter.open()
    return await run(adapter)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete (globalThis as { window?: Window }).window
  }
}

export async function testExistingElectronBootstrapLoadsBridgeExactlyOnce(): Promise<void> {
  const existing = createEmptyPersistedSnapshot()
  const storage = new MemoryAdapter(existing)
  const indexedDb = new MemoryAdapter(null)
  await withElectronBridge(storage, async (adapter) => {
    const loaded = await loadBootstrapSnapshot(adapter, 'electron', indexedDb)
    assert(loaded === existing, '已有快照必须复用 bridge 首次读取结果，零交易库同样有效')
  })
  assert(storage.opens === 1, '优化不得跳过建立桌面写入会话')
  assert(storage.loads === 1 && storage.saves === 0, '已有桌面资料库只允许一次 bridge 读取，不触发迁移写入')
  assert(indexedDb.opens === 0 && indexedDb.loads === 0, '已有桌面资料库不得打开旧 IndexedDB')
}

export async function testFirstElectronMigrationReloadsAuthoritativeSnapshot(): Promise<void> {
  const source = createEmptyPersistedSnapshot()
  const durable = { ...source, tagPresets: ['落盘后的权威内容'] }
  const storage = new MemoryAdapter(null)
  storage.onSave = () => durable
  const indexedDb = new MemoryAdapter(source)
  await withElectronBridge(storage, async (adapter) => {
    const loaded = await loadBootstrapSnapshot(adapter, 'electron', indexedDb)
    assert(loaded === durable, '首次迁移后必须重新通过 bridge 读取权威快照，不能直接发布迁移候选')
  })
  assert(storage.loads === 3 && storage.saves === 1, '空桌面库先读取、保留原迁移检查、写入后再读')
  assert(indexedDb.opens === 1, '首次迁移必须保留原 IndexedDB 打开路径')
}

export async function testWebBootstrapReusesExistingSnapshotAndNeverMigratesReadOnlyLibrary(): Promise<void> {
  for (const mode of ['web-editable', 'web-readonly'] as const) {
    const existing = createEmptyPersistedSnapshot()
    const storage = new MemoryAdapter(existing)
    assert(await loadBootstrapSnapshot(storage, mode) === existing, 'Web 已有快照必须复用首次读取')
    assert(storage.loads === 1 && storage.saves === 0, 'Web 已有库只读取一次')
  }
  const empty = new MemoryAdapter(null)
  assert(await loadBootstrapSnapshot(empty, 'web-readonly') === null, '只读空库必须保持空状态')
  assert(empty.loads === 1 && empty.saves === 0, '只读空库不得尝试迁移写入')
}

export async function testFreshWebBootstrapReloadsPersistedSeedAndMigrationFailuresPropagate(): Promise<void> {
  const storage = new MemoryAdapter(null)
  const durable = createEmptyPersistedSnapshot()
  storage.onSave = () => durable
  assert(await loadBootstrapSnapshot(storage, 'web-editable') === durable, '首次 Web 初始化后必须重新读取权威快照')
  assert(storage.loads === 3 && storage.saves === 1, '首次 Web 初始化保留迁移检查与落盘后读取')

  const failure = new Error('隔离写入失败')
  const failedStorage = new MemoryAdapter(null)
  failedStorage.onSave = () => { throw failure }
  let actual: unknown
  try { await loadBootstrapSnapshot(failedStorage, 'web-editable') } catch (error) { actual = error }
  assert(actual === failure, '迁移写入失败必须阻止启动 hydration，不能转为成功结果')
  assert(failedStorage.loads === 2 && failedStorage.snapshot === null, '迁移失败后不得继续读取或发布未保存候选')
}

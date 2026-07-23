import fs from 'node:fs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function source(path: string): string {
  return fs.readFileSync(path, 'utf8')
}

function assertExcludes(path: string, forbidden: string[]): void {
  const content = source(path)
  for (const dependency of forbidden) {
    assert(!content.includes(dependency), `${path} 不得依赖 ${dependency}`)
  }
}

export function testFoundationImportAndPersistenceEdgesStayAcyclic(): void {
  assertExcludes('src/store/useStore.ts', ["from '@/lib/importExport'"])
  assertExcludes('src/lib/importMerge.ts', [
    "from '@/store/",
    "from '@/storage/index'",
    "from '@/lib/symbolIcons'",
    'window.',
    'document.',
    'FileReader',
    'new Image',
  ])
  assertExcludes('src/lib/importTypes.ts', ["from '@/store/", "from '@/lib/importExport'"])
  assertExcludes('src/storage/persist.ts', [
    "from '@/storage/index'",
    "from '@/storage/bootstrap'",
  ])
  assertExcludes('src/storage/provider.ts', [
    "from '@/storage/bootstrap'",
    "from '@/storage/persist'",
  ])
  assertExcludes('src/storage/persistenceController.ts', [
    "from '@/store/",
    "from '@/storage/provider'",
    "from '@/storage/runtime'",
    'window.',
    'document.',
  ])
}

export function testFoundationShortcutRulesStayStateless(): void {
  assertExcludes('src/store/shortcutStore.ts', ["from '@/shortcuts/engine'"])
  assertExcludes('src/shortcuts/bindingRules.ts', [
    "from '@/store/",
    "from '@/shortcuts/engine'",
    'window.',
    'document.',
  ])
}

export function testElectronBridgeContractHasOneInterfaceSource(): void {
  const contract = source('src/types/journalBridge.ts')
  const declaration = source('src/types/journal-bridge.d.ts')
  const preload = source('electron/preload.ts')

  assert(contract.includes('export interface JournalBridge'), '共享文件必须定义 JournalBridge')
  assert(!declaration.includes('export interface JournalBridge'), 'renderer 声明不得复制 bridge 接口')
  assert(!preload.includes('interface JournalBridge'), 'preload 不得复制 bridge 接口')
  assert(declaration.includes("from '@/types/journalBridge'"), 'renderer 必须重导出共享 bridge 类型')
  assert(preload.includes("from '../src/types/journalBridge'"), 'preload 必须引用共享 bridge 类型')
}

export function testIndexedDbHasNoBlindSnapshotWriteOutsideTheCasPrimitive(): void {
  const adapter = source('src/storage/indexedDbAdapter.ts')
  const sharedWrites = source('src/storage/indexedDbSnapshotAssetWrites.ts')
  const snapshotWrites = sharedWrites.match(/snapshotStore\.put\(input\.snapshot, 'main'\)/g) ?? []
  assert(snapshotWrites.length === 1, 'IndexedDB snapshot 只能在单一共享写入原语中排队一次')
  assert(
    (adapter.match(/queueIndexedDbSnapshotAssetWrites\(/g) ?? []).length === 1,
    'revisioned mutation 必须且只能调用一次共享 snapshot/asset 写入原语',
  )
  for (const forbidden of ['snapshotRevision', 'expectedRevision', 'metaStore']) {
    assert(!sharedWrites.includes(forbidden), `共享 snapshot/asset 写入原语不得携带 ${forbidden}`)
  }
  for (const forbidden of [
    "snapshotStore.put(input.snapshot, 'main')",
    'idbPut(db, STORE_SNAPSHOT',
    "objectStore(STORE_SNAPSHOT).put",
    "objectStore('snapshot').put",
  ]) {
    assert(!adapter.includes(forbidden), `生产 adapter 不得保留 blind snapshot write：${forbidden}`)
  }
}

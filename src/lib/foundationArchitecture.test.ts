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

export function testIndexedDbHasNoBlindSnapshotWriteOutsideTheCasPrimitive(): void {
  const adapter = source('src/storage/indexedDbAdapter.ts')
  const sharedWrites = source('src/storage/indexedDbSnapshotAssetWrites.ts')
  const snapshotWrites = sharedWrites.match(/snapshotStore\.put\(input\.snapshot, 'main'\)/g) ?? []
  assert(snapshotWrites.length === 1, 'IndexedDB snapshot 只能在单一共享写入原语中排队一次')
  assert(
    (adapter.match(/queueIndexedDbSnapshotAssetWrites\(/g) ?? []).length === 1,
    'revisioned mutation 必须且只能调用一次共享 snapshot/asset 写入原语',
  )
  assert(adapter.includes("reason: 'migration'"), '历史 schema 升级必须进入 revisioned mutation')
  assert(!adapter.includes('queueIndexedDbLegacySnapshotUpgrade'), '不得保留 migration blind-write 入口')
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

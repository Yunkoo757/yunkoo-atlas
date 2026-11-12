import assert from 'node:assert/strict'
import type { JournalBridge } from '@/types/journalBridge'
import { ElectronStorageAdapter } from './electronAdapter'

type AssetBytes = NonNullable<Awaited<ReturnType<JournalBridge['getAssetBytes']>>>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const image = (id: string): AssetBytes => ({ id, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) })

async function isolated(
  getAssetBytes: JournalBridge['getAssetBytes'],
  run: (adapter: ElectronStorageAdapter, created: string[], revoked: string[]) => Promise<void>,
  overrides: Partial<JournalBridge> = {},
) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousCreate = URL.createObjectURL, previousRevoke = URL.revokeObjectURL
  const created: string[] = [], revoked: string[] = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    journalBridge: { isElectron: true, getAssetBytes, importAssets: async () => true, ...overrides },
  } })
  URL.createObjectURL = () => { const url = `blob:isolated-${created.length + 1}`; created.push(url); return url }
  URL.revokeObjectURL = url => { revoked.push(url) }
  const adapter = new ElectronStorageAdapter()
  try { await run(adapter, created, revoked) } finally {
    adapter.clearObjectUrlCache()
    URL.createObjectURL = previousCreate
    URL.revokeObjectURL = previousRevoke
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testConcurrentAssetReadersShareOneNativeReadAndOneOwnedUrl() {
  const response = deferred<AssetBytes | null>()
  let reads = 0
  await isolated(async () => { reads++; return response.promise }, async (adapter, created, revoked) => {
    const first = adapter.getAssetObjectUrl('shared'), second = adapter.getAssetObjectUrl('shared')
    response.resolve(image('shared'))
    const urls = await Promise.all([first, second])
    assert.equal(reads, 1, '同一附件的并发展示只读取一次原始字节')
    assert.equal(urls[0], urls[1])
    assert.equal(created.length, 1, '不能创建随后被 Map 覆盖且无法释放的 URL')
    adapter.clearObjectUrlCache()
    assert.deepEqual(revoked, created, '释放缓存必须覆盖本轮创建的全部 URL')
  })
}

export async function testClearedAssetReadCannotRepopulateTheNextCacheLifecycle() {
  const old = deferred<AssetBytes | null>(), current = deferred<AssetBytes | null>()
  let reads = 0
  await isolated(() => (++reads === 1 ? old.promise : current.promise), async (adapter, created) => {
    const stale = adapter.getAssetObjectUrl('shared')
    adapter.clearObjectUrlCache()
    const fresh = adapter.getAssetObjectUrl('shared')
    old.resolve(image('shared')); current.resolve(image('shared'))
    const results = await Promise.all([stale, fresh])
    assert.equal(results[0], null, '旧生命周期的迟到字节不得重新进入缓存')
    assert.equal(results[1], created[0])
    assert.equal(created.length, 1)
    assert.equal(await adapter.getAssetObjectUrl('shared'), results[1])
    assert.equal(reads, 2)
  })
}

export async function testImportedAssetInvalidatesOnlyItsOwnInflightRead() {
  const old = deferred<AssetBytes | null>(), other = deferred<AssetBytes | null>()
  await isolated(id => id === 'other' ? other.promise : old.promise, async (adapter, created) => {
    const stale = adapter.getAssetObjectUrl('imported'), unrelated = adapter.getAssetObjectUrl('other')
    await adapter.importAssets([{ id: 'imported', mime: 'image/png', data: 'AQID' }])
    old.resolve(image('imported')); other.resolve(image('other'))
    const results = await Promise.all([stale, unrelated])
    assert.equal(results[0], null)
    assert.equal(results[1], created[0], '导入某张图不能取消其他图片的有效读取')
    assert.equal(created.length, 1)
  })
}

export async function testRejectedImportKeepsThePreviouslyUsableImageUrl() {
  let reads = 0
  await isolated(async id => { reads++; return image(id) }, async (adapter, created, revoked) => {
    const url = await adapter.getAssetObjectUrl('existing')
    await assert.rejects(adapter.importAssets([{ id: 'existing', mime: 'image/png', data: 'AQID' }]), /conflict/)
    assert.equal(await adapter.getAssetObjectUrl('existing'), url)
    assert.equal(reads, 1)
    assert.equal(created.length, 1)
    assert.deepEqual(revoked, [], '导入失败不得使仍在显示的旧图失效')
  }, { importAssets: async () => { throw new Error('conflict') } })
}

export async function testFailedNativeAssetReadCanBeRetried() {
  let reads = 0
  await isolated(async id => {
    if (++reads === 1) throw new Error('temporary read failure')
    return image(id)
  }, async (adapter, created) => {
    await assert.rejects(adapter.getAssetObjectUrl('retry'), /temporary read failure/)
    assert.equal(await adapter.getAssetObjectUrl('retry'), created[0])
    assert.equal(reads, 2)
    assert.equal(created.length, 1)
  })
}

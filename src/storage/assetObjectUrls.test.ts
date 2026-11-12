import assert from 'node:assert/strict'
import { AssetObjectUrlCache, AssetObjectUrlScope, retainAssetObjectUrls } from './assetObjectUrls'
import type { StorageAdapter } from './adapter'

async function readable(url: string, text: string) { assert.equal(await (await fetch(url)).text(), text) }
async function revoked(url: string) { await assert.rejects(fetch(url)) }

export async function testVisibleOwnerSurvivesPressureAndBecomesEvictableAfterLeaving() {
  const cache = new AssetObjectUrlCache(2, 32)
  const first = (await cache.acquire('visible', async () => new Blob(['visible'])))!
  for (let i = 0; i < 20; i++) await cache.get(`other-${i}`, async () => new Blob([String(i)]))
  await readable(first.url, 'visible')
  first.release()
  for (let i = 0; i < 3; i++) await cache.get(`after-${i}`, async () => new Blob(['new']))
  await revoked(first.url)
  cache.clear()
}

export async function testIdleByteBudgetEvictsOldImagesWithoutRevokingAnActiveOwner() {
  const cache = new AssetObjectUrlCache(128, 5)
  const first = (await cache.acquire('a', async () => new Blob(['aaaa'])))!
  const second = (await cache.acquire('b', async () => new Blob(['bbbb'])))!
  await readable(first.url, 'aaaa')
  first.release()
  await readable(first.url, 'aaaa')
  second.release()
  await revoked(first.url)
  await readable(second.url, 'bbbb')
  cache.clear()
  await revoked(second.url)
}

export async function testInvalidationRetiresAnOwnedUrlUntilTheLastConsumerReleasesIt() {
  const cache = new AssetObjectUrlCache()
  const old = (await cache.acquire('same', async () => new Blob(['old'])))!
  cache.invalidate('same')
  const fresh = (await cache.acquire('same', async () => new Blob(['fresh'])))!
  assert.notEqual(fresh.url, old.url)
  await readable(old.url, 'old')
  await readable(fresh.url, 'fresh')
  old.release(); await revoked(old.url)
  fresh.release(); cache.clear(); await revoked(fresh.url)
}

export async function testConcurrentOwnersShareOneReadAndIndependentReleaseResponsibilities() {
  const cache = new AssetObjectUrlCache()
  let finish!: (blob: Blob) => void
  const waiting = new Promise<Blob>(resolve => { finish = resolve })
  let reads = 0
  const load = () => { reads++; return waiting }
  const a = cache.acquire('same', load), b = cache.acquire('same', load)
  assert.equal(reads, 1)
  finish(new Blob(['shared']))
  const [first, second] = await Promise.all([a, b])
  assert(first && second); assert.equal(first.url, second.url)
  first.release(); first.release(); cache.clear()
  await readable(second.url, 'shared')
  second.release(); await revoked(second.url)
}

export async function testLightboxLeaseCanOutliveTheSourcePageAndTheCacheEntry() {
  const cache = new AssetObjectUrlCache()
  const page = (await cache.acquire('image', async () => new Blob(['original'])))!
  const closeLightbox = retainAssetObjectUrls([page.url])
  page.release(); cache.clear()
  await readable(page.url, 'original')
  closeLightbox(); await revoked(page.url)
}

export async function testAnUnmountedScopeDoesNotKeepALateAcquisitionAlive() {
  const cache = new AssetObjectUrlCache(0, 0)
  let finish!: (blob: Blob) => void
  const pending = new Promise<Blob>(resolve => { finish = resolve })
  const adapter = {
    acquireAssetObjectUrl: (id: string) => cache.acquire(id, () => pending),
  } as unknown as StorageAdapter
  const scope = new AssetObjectUrlScope()
  const requested = scope.get(adapter, 'late')
  scope.release()
  finish(new Blob(['late']))
  assert.equal(await requested, null)
  cache.clear()
}

export async function testAScopeCanRetryAFailedReadWithoutRemountingTheEditor() {
  const cache = new AssetObjectUrlCache()
  let attempts = 0
  const adapter = { acquireAssetObjectUrl: (id: string) => cache.acquire(id, async () => {
    if (++attempts === 1) throw new Error('temporary read failure')
    return new Blob(['retried'])
  }) } as unknown as StorageAdapter
  const scope = new AssetObjectUrlScope()
  await assert.rejects(scope.get(adapter, 'retry'))
  const url = await scope.get(adapter, 'retry')
  assert(url); await readable(url, 'retried')
  scope.release(); cache.clear(); await revoked(url)
}

import { revokeObjectUrlAfterExit } from '@/lib/objectUrl'
import type { StorageAdapter } from './adapter'

export interface AssetObjectUrlLease {
  url: string
  release(): void
}

type Entry = { id: string; url: string; bytes: number; references: number; retired: boolean; disposed: boolean; owner: AssetObjectUrlCache }
type Read = { references: number; promise: Promise<Entry | null> }
const managedUrls = new Map<string, Entry>()
const MAX_IDLE_ENTRIES = 128
const MAX_IDLE_BYTES = 64 * 1024 * 1024

/** 可见正文/编辑器/灯箱持有租约；只有未持有的预览才参与 LRU 淘汰。 */
export class AssetObjectUrlCache {
  private entries = new Map<string, Entry>()
  private reads = new Map<string, Read>()
  private idleEntries = new Map<string, Entry>()
  private idleBytes = 0

  constructor(private readonly maxEntries = MAX_IDLE_ENTRIES, private readonly maxBytes = MAX_IDLE_BYTES) {}

  private dispose(entry: Entry): void {
    if (entry.disposed) return
    entry.disposed = true
    managedUrls.delete(entry.url)
    try { revokeObjectUrlAfterExit(entry.url) } catch { /* 清理不得阻断切库或关闭。 */ }
  }

  private forgetIdle(entry: Entry): void {
    if (this.idleEntries.get(entry.id) !== entry) return
    this.idleEntries.delete(entry.id)
    this.idleBytes -= entry.bytes
  }

  private rememberIdle(entry: Entry): void {
    this.forgetIdle(entry)
    this.idleEntries.set(entry.id, entry)
    this.idleBytes += entry.bytes
  }

  private retire(entry: Entry): void {
    this.forgetIdle(entry)
    entry.retired = true
    if (entry.references === 0) this.dispose(entry)
  }

  private trim(): void {
    while (this.idleEntries.size > this.maxEntries || this.idleBytes > this.maxBytes) {
      const entry = this.idleEntries.values().next().value as Entry | undefined
      if (!entry) break
      this.entries.delete(entry.id)
      this.retire(entry)
    }
  }

  private async read(id: string, load: () => Promise<Blob | null>, retain: boolean): Promise<Entry | null> {
    const cached = this.entries.get(id)
    if (cached) {
      this.entries.delete(id)
      this.entries.set(id, cached)
      if (retain) { this.forgetIdle(cached); cached.references++ }
      else if (cached.references === 0) this.rememberIdle(cached)
      return cached
    }
    let pending = this.reads.get(id)
    if (pending) {
      if (retain) pending.references++
      return pending.promise
    }
    pending = { references: retain ? 1 : 0, promise: null as unknown as Promise<Entry | null> }
    const operation = pending
    this.reads.set(id, operation)
    operation.promise = (async () => {
      const blob = await load()
      if (!blob || this.reads.get(id) !== operation) return null
      const entry: Entry = { id, url: URL.createObjectURL(blob), bytes: blob.size, references: operation.references, retired: false, disposed: false, owner: this }
      managedUrls.set(entry.url, entry)
      this.entries.set(id, entry)
      if (entry.references === 0) this.rememberIdle(entry)
      this.trim()
      return entry.disposed ? null : entry
    })()
    try { return await operation.promise } finally {
      if (this.reads.get(id) === operation) this.reads.delete(id)
    }
  }

  /** 兼容临时读取；长期展示必须 acquire，并在消费者离开时 release。 */
  async get(id: string, load: () => Promise<Blob | null>): Promise<string | null> {
    return (await this.read(id, load, false))?.url ?? null
  }

  async acquire(id: string, load: () => Promise<Blob | null>): Promise<AssetObjectUrlLease | null> {
    const entry = await this.read(id, load, true)
    return entry ? this.lease(entry, false) : null
  }

  private lease(entry: Entry, increment: boolean): AssetObjectUrlLease {
    if (increment) { this.forgetIdle(entry); entry.references++ }
    let released = false
    return { url: entry.url, release: () => {
      if (released) return
      released = true
      entry.references--
      if (entry.references === 0) {
        if (entry.retired) this.dispose(entry)
        else this.rememberIdle(entry)
      }
      this.trim()
    } }
  }

  retain(url: string): AssetObjectUrlLease | null {
    const entry = managedUrls.get(url)
    return entry && !entry.disposed ? this.lease(entry, true) : null
  }

  invalidate(id: string): void {
    this.reads.delete(id)
    const entry = this.entries.get(id)
    this.entries.delete(id)
    if (entry) this.retire(entry)
  }

  clear(): void {
    this.reads.clear()
    for (const entry of this.entries.values()) this.retire(entry)
    this.entries.clear()
  }
}

/** 同一页面内同 ID 只持有一份租约；迟到结果自动释放，不会泄漏到下一页。 */
export class AssetObjectUrlScope {
  private closed = false
  private reads = new Map<string, Promise<string | null>>()
  private releases: Array<() => void> = []

  get(adapter: StorageAdapter, id: string): Promise<string | null> {
    if (this.closed) return Promise.resolve(null)
    const active = this.reads.get(id)
    if (active) return active
    const operation = (async () => {
      if (!adapter.acquireAssetObjectUrl) return this.closed ? null : adapter.getAssetObjectUrl(id)
      const lease = await adapter.acquireAssetObjectUrl(id)
      if (!lease) return null
      if (this.closed) { lease.release(); return null }
      this.releases.push(() => lease.release())
      return lease.url
    })()
    this.reads.set(id, operation)
    void operation.then(value => {
      if (value === null && this.reads.get(id) === operation) this.reads.delete(id)
    }, () => {
      if (this.reads.get(id) === operation) this.reads.delete(id)
    })
    return operation
  }

  release(): void {
    if (this.closed) return
    this.closed = true
    for (const release of this.releases) release()
    this.releases = []
    this.reads.clear()
  }
}

/** 灯箱可以比来源页面活得更久；独立持有整组地址直到关闭或换组。 */
export function retainAssetObjectUrls(urls: readonly string[]): () => void {
  const leases = [...new Set(urls)].flatMap(url => {
    const entry = managedUrls.get(url)
    const lease = entry?.owner.retain(url)
    return lease ? [lease] : []
  })
  return () => { for (const lease of leases) lease.release() }
}

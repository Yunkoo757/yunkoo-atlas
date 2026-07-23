import JSZip from 'jszip'

import { parseWebJournalArchive } from '@/lib/webJournalArchive'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import type { PersistedSnapshot } from '@/storage/types'

interface WebZipBenchmarkInput {
  assetSizes: number[]
}

interface WebZipBenchmarkResult {
  compressedBytes: number
  expandedBytes: number
  peakJsHeapBytes: number
  baselineJsHeapBytes: number
  revision: number
  assetCount: number
}

declare global {
  interface Window {
    gc?: () => void
    prepareWebZipBenchmark?: (input: WebZipBenchmarkInput) => Promise<void>
    runWebZipBenchmark?: () => Promise<WebZipBenchmarkResult>
  }
}

const CACHE_NAME = 'web-zip-benchmark-v1'
const CACHE_KEY = '/__web-zip-benchmark-fixture'

function currentHeap(): number {
  return (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0
}

window.prepareWebZipBenchmark = async ({ assetSizes }) => {
  const ids = assetSizes.map((_, index) => `heap-asset-${index + 1}`)
  const note = ids.map((id) => `<img src="journal-asset://${id}">`).join('')
  const snapshot: PersistedSnapshot = {
    trades: [{
      id: 'heap-trade', ref: 'TRD-HEAP', symbol: 'BTCUSDT', side: 'long', status: 'open',
      conviction: 'medium', strategyId: 'heap-strategy', tradeKind: 'live', tags: [], mistakeTags: [],
      reviewStatus: 'unreviewed', reviewCategory: 'normal', entry: 1, exit: null, size: 1,
      pnl: null, rMultiple: null, openedAt: '2026-07-23', closedAt: null, note,
    }],
    strategies: [{ id: 'heap-strategy', name: 'Heap fixture', color: '#5e6ad2', icon: 'target' }],
    starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }
  let zip: JSZip | null = new JSZip()
  zip.file('data.json', JSON.stringify({
    version: 8,
    schemaVersion: 8,
    ...snapshot,
    assets: ids.map((id) => ({ id, mime: 'image/png' })),
  }))
  zip.folder('assets')
  for (let index = 0; index < ids.length; index += 1) {
    zip.file(`assets/${ids[index]}.png`, new Uint8Array(assetSizes[index]), { compression: 'DEFLATE' })
  }
  const archive = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  })
  const cache = await caches.open(CACHE_NAME)
  await cache.put(CACHE_KEY, new Response(archive))
  zip = null
}

window.runWebZipBenchmark = async () => {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(CACHE_KEY)
  if (!cached) throw new Error('Web ZIP heap fixture cache missing')
  const archive = await cached.blob()
  window.gc?.()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

  const baselineJsHeapBytes = currentHeap()
  let peakJsHeapBytes = baselineJsHeapBytes
  const sampler = window.setInterval(() => {
    peakJsHeapBytes = Math.max(peakJsHeapBytes, currentHeap())
  }, 10)
  const databaseName = `web-zip-heap-${crypto.randomUUID()}`
  const adapter = new IndexedDbStorageAdapter(databaseName)
  try {
    const parsed = await parseWebJournalArchive(archive)
    peakJsHeapBytes = Math.max(peakJsHeapBytes, currentHeap())
    await adapter.open()
    await adapter.replaceArchive(parsed.snapshot, parsed.assets)
    peakJsHeapBytes = Math.max(peakJsHeapBytes, currentHeap())
    const loaded = await adapter.loadSnapshotEnvelope()
    if (loaded.snapshot?.trades[0]?.id !== 'heap-trade') throw new Error('Web ZIP commit 后快照不一致')
    const ids = parsed.assets.map((asset) => asset.id)
    for (const id of ids) {
      const asset = await adapter.getAssetForExport(id)
      if (!asset) throw new Error(`Web ZIP commit 后附件缺失：${id}`)
    }
    return {
      compressedBytes: parsed.preview.compressedBytes,
      expandedBytes: parsed.preview.expandedBytes,
      peakJsHeapBytes,
      baselineJsHeapBytes,
      revision: loaded.revision,
      assetCount: ids.length,
    }
  } finally {
    window.clearInterval(sampler)
    adapter.close()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Web ZIP heap benchmark 清理被阻塞'))
    })
    await caches.delete(CACHE_NAME)
  }
}

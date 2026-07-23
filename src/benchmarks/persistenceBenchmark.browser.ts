import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { StorageRevisionConflictError } from '@/storage/adapter'
import { bootstrapStorage } from '@/storage/bootstrap'
import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import {
  disablePersistWrites,
  getPersistenceDiagnostics,
  pickPersisted,
  resetPersistenceDiagnostics,
} from '@/storage/persist'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import { SCHEMA_VERSION, type ExportAssetRecord, type PersistedSnapshot } from '@/storage/types'
import { useSaveStatus } from '@/store/saveStatus'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { clearWebWriteConflictAfterReload } from '@/storage/webWriteGuard'

interface BenchmarkInput {
  label: '10k' | '20k'
  snapshot: PersistedSnapshot
  assets: ExportAssetRecord[]
  expectedHash: string
  warmups: number
  samples: number
}

interface BenchmarkResult {
  label: string
  saveSamplesMs: number[]
  dirtyConfirmedSamplesMs: number[]
  staleConflictSamplesMs: number[]
  longTaskSamplesMs: number[]
  finalRevision: number
  checksum: string
  fixtureChecksum: string
  maxPendingSnapshotCount: number
}

declare global {
  interface Window {
    runWebPersistenceBenchmark?: (input: BenchmarkInput) => Promise<BenchmarkResult>
  }
}

async function digestJson(json: string): Promise<string> {
  const bytes = new TextEncoder().encode(json)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)),
    )
  })
}

function sha256(value: unknown): Promise<string> {
  return digestJson(canonicalJson(value))
}

function waitForTransactionTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function verifyAssets(
  adapter: IndexedDbStorageAdapter,
  expected: readonly ExportAssetRecord[],
): Promise<void> {
  for (const asset of expected) {
    const loaded = await adapter.getAssetForExport(asset.id)
    if (!loaded || loaded.mime !== asset.mime || loaded.data !== asset.data) {
      throw new Error(`durable reload 附件不一致：${asset.id}`)
    }
  }
}

async function observeLongTasks(operation: () => Promise<void>): Promise<number[]> {
  const durations: number[] = []
  const observer = typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) durations.push(entry.duration)
      })
    : null
  observer?.observe({ entryTypes: ['longtask'] })
  await operation()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  for (const entry of observer?.takeRecords() ?? []) durations.push(entry.duration)
  observer?.disconnect()
  return durations
}

function waitForSavedUi(container: HTMLElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe()
      reject(new Error('dirty→confirmed 等待“已保存”超时'))
    }, 10_000)
    const unsubscribe = useSaveStatus.subscribe((state) => {
      if (state.status !== 'saved') return
      requestAnimationFrame(() => {
        if (!container.textContent?.includes('已保存')) return
        window.clearTimeout(timeout)
        unsubscribe()
        resolve()
      })
    })
  })
}

window.runWebPersistenceBenchmark = async (input) => {
  const databaseName = `persistence-benchmark-${input.label}-${crypto.randomUUID()}`
  const adapter = new IndexedDbStorageAdapter(databaseName)
  let stale: IndexedDbStorageAdapter | null = null
  await adapter.open()
  const uiAdapter = getIndexedDbAdapter()
  const indicatorHost = document.createElement('div')
  document.body.appendChild(indicatorHost)
  const indicatorRoot = createRoot(indicatorHost)

  try {
    if (await digestJson(JSON.stringify(input.snapshot)) !== input.expectedHash) {
      throw new Error(`${input.label} fixture checksum 在进入 adapter 前已变化`)
    }
    await adapter.commitImport(input.snapshot, input.assets)
    const canonical = await adapter.loadSnapshotEnvelope()
    const durableHash = await sha256(canonical.snapshot)
    for (let index = 0; index < input.warmups; index += 1) {
      await adapter.saveSnapshot(input.snapshot)
    }

    const saveSamplesMs: number[] = []
    let expectedRevision = (await adapter.loadSnapshotEnvelope()).revision
    for (let index = 0; index < input.samples; index += 1) {
      const startedAt = performance.now()
      await adapter.saveSnapshot(input.snapshot)
      saveSamplesMs.push(performance.now() - startedAt)
      const loaded = await adapter.loadSnapshotEnvelope()
      expectedRevision += 1
      if (loaded.revision !== expectedRevision) {
        throw new Error(`${input.label} Web revision 未按 N→N+1 推进`)
      }
      if (await sha256(loaded.snapshot) !== durableHash) {
        throw new Error(`${input.label} Web 保存后 checksum 不一致`)
      }
      await verifyAssets(adapter, input.assets)
      await waitForTransactionTurn()
    }

    await uiAdapter.open()
    await uiAdapter.commitImport(input.snapshot, input.assets)
    await bootstrapStorage()
    indicatorRoot.render(createElement(SaveStatusIndicator))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const dirtyConfirmedSamplesMs: number[] = []
    const longTaskSamplesMs: number[] = []
    let maxPendingSnapshotCount = 0
    let uiRevision = (await uiAdapter.loadSnapshotEnvelope()).revision

    resetPersistenceDiagnostics()
    const burstSavedUi = waitForSavedUi(indicatorHost)
    for (let mutation = 0; mutation < 25; mutation += 1) {
      const trade = useStore.getState().trades[0]
      if (!trade) throw new Error('pending burst 缺少基准交易')
      useStore.getState().updateTradeData(trade.id, {
        timeframe: trade.timeframe === '4H' ? '1H' : '4H',
      })
    }
    await burstSavedUi
    const burstLoaded = await uiAdapter.loadSnapshotEnvelope()
    uiRevision += 1
    if (burstLoaded.revision !== uiRevision) throw new Error('25 次连续编辑必须合并为一次 durable revision')
    const burstExpected = decodeCanonicalSnapshot(
      pickPersisted(useStore.getState(), useShortcutStore.getState().bindings),
      { version: SCHEMA_VERSION, label: 'Persistence pending burst expected snapshot' },
    )
    if (await sha256(burstLoaded.snapshot) !== await sha256(burstExpected)) {
      throw new Error('25 次连续编辑合并后 durable checksum 不是最后一个 Store 状态')
    }
    await verifyAssets(uiAdapter, input.assets)
    maxPendingSnapshotCount = getPersistenceDiagnostics().maxPendingSnapshotCount
    if (maxPendingSnapshotCount > 1) throw new Error('25 次连续编辑产生了超过一个 pending snapshot')
    useSaveStatus.getState().reset()

    for (let index = 0; index < input.warmups + input.samples; index += 1) {
      resetPersistenceDiagnostics()
      const savedUi = waitForSavedUi(indicatorHost)
      const startedAt = performance.now()
      const durations = await observeLongTasks(async () => {
        const trade = useStore.getState().trades[0]
        if (!trade) throw new Error('dirty→confirmed 缺少基准交易')
        useStore.getState().updateTradeData(trade.id, {
          timeframe: trade.timeframe === '4H' ? '1H' : '4H',
        })
        await savedUi
      })
      const elapsed = performance.now() - startedAt
      const loaded = await uiAdapter.loadSnapshotEnvelope()
      uiRevision += 1
      if (loaded.revision !== uiRevision) throw new Error('Store 保存 revision 未按 N→N+1 推进')
      const expectedSnapshot = pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
      const canonicalExpected = decodeCanonicalSnapshot(expectedSnapshot, {
        version: SCHEMA_VERSION,
        label: 'Persistence benchmark expected snapshot',
      })
      if (await sha256(loaded.snapshot) !== await sha256(canonicalExpected)) {
        const differing = [...new Set([
          ...Object.keys(canonicalExpected),
          ...Object.keys(loaded.snapshot ?? {}),
        ])].filter((key) =>
          JSON.stringify((loaded.snapshot as unknown as Record<string, unknown> | null)?.[key]) !==
          JSON.stringify((canonicalExpected as unknown as Record<string, unknown>)[key]),
        )
        throw new Error(`Store dirty→confirmed 后 durable checksum 不一致：${differing.join(',')}`)
      }
      await verifyAssets(uiAdapter, input.assets)
      maxPendingSnapshotCount = Math.max(
        maxPendingSnapshotCount,
        getPersistenceDiagnostics().maxPendingSnapshotCount,
      )
      if (index >= input.warmups) {
        dirtyConfirmedSamplesMs.push(elapsed)
        longTaskSamplesMs.push(...durations)
      }
      useSaveStatus.getState().reset()
    }

    disablePersistWrites()
    uiAdapter.close()

    const staleConflictSamplesMs: number[] = []
    let winner = await adapter.loadSnapshotEnvelope()
    for (let index = 0; index < input.warmups + input.samples; index += 1) {
      stale = new IndexedDbStorageAdapter(databaseName)
      await stale.open()
      await stale.loadSnapshotEnvelope()
      await adapter.saveSnapshot(input.snapshot)
      const winnerBeforeConflict = await adapter.loadSnapshotEnvelope()
      const winnerHashBeforeConflict = await sha256(winnerBeforeConflict.snapshot)
      let conflict: unknown
      const conflictStartedAt = performance.now()
      try {
        await stale.saveSnapshot(input.snapshot)
      } catch (error) {
        conflict = error
      }
      const elapsed = performance.now() - conflictStartedAt
      if (!(conflict instanceof StorageRevisionConflictError)) {
        throw new Error('真实 Web stale writer 必须返回 typed conflict')
      }
      winner = await adapter.loadSnapshotEnvelope()
      if (
        winner.revision !== winnerBeforeConflict.revision ||
        await sha256(winner.snapshot) !== winnerHashBeforeConflict
      ) {
        throw new Error('stale conflict 后赢家 checksum/revision 发生变化')
      }
      await verifyAssets(adapter, input.assets)
      if (index >= input.warmups) staleConflictSamplesMs.push(elapsed)
      clearWebWriteConflictAfterReload(winner.revision)
      stale.close()
      stale = null
    }

    return {
      label: input.label,
      saveSamplesMs,
      dirtyConfirmedSamplesMs,
      staleConflictSamplesMs,
      longTaskSamplesMs,
      finalRevision: winner.revision,
      checksum: durableHash,
      fixtureChecksum: input.expectedHash,
      maxPendingSnapshotCount,
    }
  } finally {
    indicatorRoot.unmount()
    indicatorHost.remove()
    stale?.close()
    adapter.close()
    uiAdapter.close()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('性能基准 IndexedDB 清理被阻塞'))
    })
  }
}

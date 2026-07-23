import { buildWebConflictRecoveryPayload } from '@/lib/importExport'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import type { PersistedSnapshot } from '@/storage/types'
import {
  clearWebWriteConflictAfterReload,
  getWebWriteGuardState,
  initializeWebWriterOwnership,
  releaseWebWriterOwnership,
  requestWebWriterOwnership,
  resetWebWriteGuardForTests,
} from '@/storage/webWriteGuard'

const contextId = new URLSearchParams(location.search).get('id') ?? 'unknown'
const databaseName = new URLSearchParams(location.search).get('db') ?? 'missing-test-db'
const adapter = new IndexedDbStorageAdapter(databaseName)
let candidate: PersistedSnapshot | null = null

function snapshot(label: string, assetId?: string): PersistedSnapshot {
  const fixture = createFullPersistedSnapshotFixture()
  return {
    ...fixture,
    trades: fixture.trades.map((trade, index) => ({
      ...trade,
      note: index === 0 && assetId ? `<p>${label}<img src="journal-asset://${assetId}"></p>` : '',
    })),
    weeklyReviews: fixture.weeklyReviews?.map((review) => ({ ...review, contentHtml: '' })),
    quickNotes: fixture.quickNotes?.map((note) => ({ ...note, contentHtml: '' })),
    profile: { ...fixture.profile!, displayName: label },
  }
}

async function handle(command: string, payload: Record<string, unknown>): Promise<unknown> {
  if (command === 'init-ownership') {
    resetWebWriteGuardForTests()
    await initializeWebWriterOwnership(
      String(payload.libraryId),
      payload.mode === 'fallback'
        ? { lockManager: null, broadcastFactory: null }
        : undefined,
    )
    return getWebWriteGuardState()
  }
  if (command === 'state') return getWebWriteGuardState()
  if (command === 'release') {
    releaseWebWriterOwnership()
    return getWebWriteGuardState()
  }
  if (command === 'request-ownership') {
    await requestWebWriterOwnership()
    return getWebWriteGuardState()
  }
  if (command === 'open') {
    await adapter.open()
    return adapter.getManifest()
  }
  if (command === 'close') {
    adapter.close()
    resetWebWriteGuardForTests()
    return null
  }
  if (command === 'load') {
    const envelope = await adapter.loadSnapshotEnvelope()
    return { revision: envelope.revision, label: envelope.snapshot?.profile?.displayName ?? null }
  }
  if (command === 'prepare') {
    const label = String(payload.label)
    let assetId: string | undefined
    if (payload.withAsset === true) {
      assetId = await adapter.saveAsset(new Blob([`asset-${label}`], { type: 'image/png' }), 'image/png')
    }
    candidate = snapshot(label, assetId)
    return { assetId }
  }
  if (command === 'save') {
    if (!candidate) throw new Error('Missing candidate')
    try {
      await adapter.saveSnapshot(candidate)
      return { ok: true, state: getWebWriteGuardState() }
    } catch (error) {
      return {
        ok: false,
        name: error instanceof Error ? error.name : 'UnknownError',
        code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
        state: getWebWriteGuardState(),
      }
    }
  }
  if (command === 'recovery') {
    if (!candidate) throw new Error('Missing candidate')
    const result = await buildWebConflictRecoveryPayload(
      candidate,
      (id) => adapter.getAssetForExport(id),
    )
    return {
      complete: result.payload.recovery.complete,
      missingAssetIds: result.missingAssetIds,
      assetIds: result.payload.assets.map((asset) => asset.id),
      label: result.payload.profile?.displayName,
    }
  }
  if (command === 'read-asset') {
    return { found: (await adapter.getAssetForExport(String(payload.assetId))) !== null }
  }
  if (command === 'reload-latest') {
    const envelope = await adapter.loadSnapshotEnvelope()
    candidate = envelope.snapshot
    clearWebWriteConflictAfterReload(envelope.revision)
    return {
      revision: envelope.revision,
      label: envelope.snapshot?.profile?.displayName ?? null,
      state: getWebWriteGuardState(),
    }
  }
  throw new Error(`Unknown command: ${command}`)
}

window.addEventListener('message', (event) => {
  if (event.source !== parent || event.origin !== location.origin) return
  const data = event.data as { requestId?: string; command?: string; payload?: Record<string, unknown> }
  if (!data.requestId || !data.command) return
  void handle(data.command, data.payload ?? {}).then(
    (result) => parent.postMessage({ contextId, requestId: data.requestId, ok: true, result }, location.origin),
    (error) => parent.postMessage({
      contextId,
      requestId: data.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, location.origin),
  )
})

parent.postMessage({ contextId, ready: true }, location.origin)

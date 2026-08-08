import { createFullPersistedSnapshotFixture } from '../src/storage/fixtures/fullPersistedSnapshot'
import { LibraryStorage } from './library/storage'
import { resolveLiveRecordBucket } from '../src/lib/liveStatisticsArchive'
import { createHash } from 'node:crypto'

function snapshotRevision(snapshot: unknown): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function snapshot(label: string, noteBytes = 0) {
  const value = createFullPersistedSnapshotFixture()
  value.profile = {
    avatarId: value.profile?.avatarId ?? null,
    displayName: label,
    customAvatarDataUrl: value.profile?.customAvatarDataUrl ?? null,
  }
  if (noteBytes > 0) {
    value.trades[0] = {
      ...value.trades[0],
      note: `<p>${'x'.repeat(noteBytes)}</p>`,
    }
  }
  value.trades = [
    ...value.trades,
    {
      ...value.trades[0],
      id: 'trade-archive-contract',
      ref: 'TRD-ARCHIVE-CONTRACT',
      openedAt: '2026-07-12T08:00:00.000Z',
      closedAt: '2026-07-13T08:00:00.000Z',
      closedTradingDayKey: '2026-07-13',
    },
  ]
  return value
}

function send(message: Record<string, unknown>): void {
  process.send?.({
    ...message,
    runtime: 'electron-main',
    electronVersion: process.versions.electron,
    processId: process.pid,
  })
}

export async function runElectronForcedKillMode(mode: string, libraryRoot: string): Promise<void> {
  const storage = new LibraryStorage(libraryRoot, {
    ensureDirectories: mode === 'seed',
    allowCreate: mode === 'seed',
    beforeAtomicReplace: mode === 'crash-save'
      ? () => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000)
        }
      : undefined,
  })
  await storage.open()

  if (mode === 'seed') {
    const confirmed = snapshot('confirmed-revision-1')
    const cycles = confirmed.livePerformanceCycles ?? []
    storage.saveSnapshot(confirmed)
    storage.release()
    send({
      type: 'seeded',
      confirmed: 'confirmed-revision-1',
      snapshotRevision: snapshotRevision(confirmed),
      livePerformanceCycleIds: cycles.map((cycle) => cycle.id),
    })
    return
  }

  if (mode === 'crash-save') {
    const pending = snapshot('unconfirmed-revision-2', 128 * 1024 * 1024)
    send({ type: 'save-starting', pending: 'unconfirmed-revision-2' })
    await new Promise<void>((resolve) => setImmediate(resolve))
    storage.saveSnapshot(pending)
    storage.release()
    send({ type: 'save-completed' })
    return
  }

  if (mode === 'verify') {
    const loaded = storage.loadSnapshot()
    storage.release()
    const cycles = loaded?.livePerformanceCycles ?? []
    const trades = loaded?.trades ?? []
    const tradingDayStartHour = loaded?.display?.tradingDayStartHour ?? 0
    send({
      type: 'verified',
      displayName: loaded?.profile?.displayName ?? null,
      noteLength: loaded?.trades[0]?.note.length ?? null,
      snapshotRevision: loaded ? snapshotRevision(loaded) : null,
      livePerformanceCycleIds: cycles.map((cycle) => cycle.id),
      currentTradeIds: trades
        .filter((trade) => resolveLiveRecordBucket(trade, cycles, tradingDayStartHour) === 'current')
        .map((trade) => trade.id) ?? [],
      archiveTradeIds: trades
        .filter((trade) => resolveLiveRecordBucket(trade, cycles, tradingDayStartHour) === 'archive')
        .map((trade) => trade.id) ?? [],
    })
    return
  }

  storage.release()
  throw new Error(`unknown Electron forced-kill mode: ${mode}`)
}

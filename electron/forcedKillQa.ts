import { createFullPersistedSnapshotFixture } from '../src/storage/fixtures/fullPersistedSnapshot'
import { LibraryStorage } from './library/storage'
import { createHash } from 'node:crypto'
import { ELECTRON_BUILD_IDENTITY } from './buildIdentity'

function snapshotRevision(snapshot: unknown): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export function createForcedKillSnapshot(label: string, noteBytes = 0) {
  const value = createFullPersistedSnapshotFixture()
  const archivedStage = {
    ...value.liveStages[0]!,
    startsOn: '2026-07-06',
    status: 'archived' as const,
    endsOn: '2026-07-12',
    archivedAt: '2026-07-13T00:00:00.000Z',
  }
  const currentStage = {
    id: 'live-stage-current-contract',
    sequence: 2,
    name: '当前强杀验证阶段',
    status: 'current' as const,
    startsOn: '2026-07-13',
    endsOn: null,
    createdAt: '2026-07-13T00:00:00.000Z',
    archivedAt: null,
  }
  value.liveStages = [archivedStage, currentStage]
  value.currentLiveStageId = currentStage.id
  value.profile = {
    avatarId: value.profile?.avatarId ?? null,
    displayName: label,
    customAvatarDataUrl: value.profile?.customAvatarDataUrl ?? null,
    legacyCashCurrencyAssumption: value.profile?.legacyCashCurrencyAssumption ?? null,
  }
  if (noteBytes > 0) {
    value.trades[0] = {
      ...value.trades[0],
      note: `<p>${'x'.repeat(noteBytes)}</p>`,
    }
  }
  value.trades = [
    ...value.trades.map((trade) => ({ ...trade, liveStageId: currentStage.id })),
    {
      ...value.trades[0],
      id: 'trade-archive-contract',
      ref: 'TRD-ARCHIVE-CONTRACT',
      openedAt: '2026-07-11T08:00:00.000Z',
      closedAt: '2026-07-12T08:00:00.000Z',
      closedTradingDayKey: '2026-07-12',
      liveStageId: archivedStage.id,
    },
  ]
  value.weeklyRiskPreparations = value.weeklyRiskPreparations.map((entity) => ({
    ...entity,
    liveStageId: currentStage.id,
  }))
  value.riskPolicyVersions = value.riskPolicyVersions.map((entity) => ({
    ...entity,
    liveStageId: currentStage.id,
  }))
  value.monthlyRiskLimits = value.monthlyRiskLimits.map((entity) => ({
    ...entity,
    liveStageId: currentStage.id,
  }))
  value.riskOverrideEvents = value.riskOverrideEvents.map((entity) => ({
    ...entity,
    liveStageId: currentStage.id,
  }))
  value.weeklyReviews = value.weeklyReviews?.map((review) => ({
    ...review,
    liveStageId: currentStage.id,
  }))
  return value
}

function send(message: Record<string, unknown>): void {
  process.send?.({
    ...message,
    buildIdentity: ELECTRON_BUILD_IDENTITY,
    runtime: 'electron-main',
    electronVersion: process.versions.electron,
    processId: process.pid,
  })
}

export async function runElectronForcedKillMode(mode: string, libraryRoot: string): Promise<void> {
  if (mode === 'identity') {
    send({ type: 'identity' })
    return
  }
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
    const confirmed = createForcedKillSnapshot('confirmed-revision-1')
    storage.saveSnapshot(confirmed)
    const confirmedStored = storage.loadSnapshot()
    if (!confirmedStored) {
      storage.release()
      throw new Error('无法重读最后确认 revision')
    }
    storage.release()
    send({
      type: 'seeded',
      confirmed: 'confirmed-revision-1',
      snapshotRevision: snapshotRevision(confirmedStored),
      liveStageIds: confirmedStored.liveStages.map((stage) => stage.id),
    })
    return
  }

  if (mode === 'crash-save') {
    const pending = createForcedKillSnapshot('unconfirmed-revision-2', 128 * 1024 * 1024)
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
    const stages = loaded?.liveStages ?? []
    const trades = loaded?.trades ?? []
    const archivedStageIds = new Set(stages.filter((stage) => stage.status === 'archived').map((stage) => stage.id))
    send({
      type: 'verified',
      displayName: loaded?.profile?.displayName ?? null,
      noteLength: loaded?.trades[0]?.note.length ?? null,
      snapshotRevision: loaded ? snapshotRevision(loaded) : null,
      liveStageIds: stages.map((stage) => stage.id),
      currentTradeIds: trades
        .filter((trade) => trade.tradeKind === 'live' && trade.liveStageId === loaded?.currentLiveStageId)
        .map((trade) => trade.id) ?? [],
      archiveTradeIds: trades
        .filter((trade) => trade.tradeKind === 'live' && typeof trade.liveStageId === 'string' && archivedStageIds.has(trade.liveStageId))
        .map((trade) => trade.id) ?? [],
    })
    return
  }

  storage.release()
  throw new Error(`unknown Electron forced-kill mode: ${mode}`)
}

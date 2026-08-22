import { bindingsForPersist, useShortcutStore } from '@/store/shortcutStore'
import type { ShortcutBinding } from '@/shortcuts/types'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'
import {
  PersistenceController,
  type PersistenceDiagnostics,
} from '@/storage/persistenceController'
import { getStorage } from '@/storage/provider'
import type { CanonicalSnapshot } from '@/storage/snapshotCodec'
import type { PersistedSnapshot } from '@/storage/types'
import { getCurrentLiveStage } from '@/lib/liveStages'
import { migrateLegacyStageSnapshot } from '@/lib/stageMigration'

type PersistableState = Omit<
  CanonicalSnapshot,
  'shortcuts' | 'liveStages' | 'currentLiveStageId' | 'scheduledStageRollover'
> & Partial<Pick<
  CanonicalSnapshot,
  'liveStages' | 'currentLiveStageId' | 'scheduledStageRollover'
>>

export function pickPersisted(
  state: PersistableState,
  shortcutBindings?: Record<string, ShortcutBinding | null>,
): CanonicalSnapshot {
  const shortcuts = bindingsForPersist(shortcutBindings ?? {})
  const latestCycle = state.livePerformanceCycles.at(-1)
  const fallbackDay = latestCycle?.startTradingDayKey ?? state.liveStatsStartTradingDayKey ?? '1970-01-01'
  const hasCanonicalStageState = Boolean(
    state.liveStages && state.currentLiveStageId && state.scheduledStageRollover !== undefined,
  )
  const staged = hasCanonicalStageState
    ? state as PersistableState & Required<Pick<
        CanonicalSnapshot,
        'liveStages' | 'currentLiveStageId' | 'scheduledStageRollover'
      >>
    : migrateLegacyStageSnapshot(state as unknown as Record<string, unknown>, {
        now: latestCycle?.createdAt ?? `${fallbackDay}T00:00:00.000Z`,
        currentTradingDayKey: fallbackDay,
        idFactory: (sequence) => `legacy-live-stage-${sequence}`,
      }) as CanonicalSnapshot
  const currentStage = getCurrentLiveStage(staged.liveStages, staged.currentLiveStageId)
  const compatibilityCycles = hasCanonicalStageState
    ? [{
        id: `legacy-stage-${currentStage.sequence}`,
        name: currentStage.name,
        startTradingDayKey: currentStage.startsOn,
        createdAt: currentStage.createdAt,
      }]
    : state.livePerformanceCycles.map((cycle) => {
        const stage = staged.liveStages.find((candidate) => candidate.startsOn === cycle.startTradingDayKey)
        return stage
          ? { ...cycle, startTradingDayKey: stage.startsOn, createdAt: stage.createdAt }
          : { ...cycle }
      })
  return {
    trades: staged.trades,
    liveStages: staged.liveStages.map((stage) => ({ ...stage })),
    currentLiveStageId: currentStage.id,
    scheduledStageRollover: staged.scheduledStageRollover
      ? { ...staged.scheduledStageRollover }
      : null,
    weeklyRiskPreparations: staged.weeklyRiskPreparations,
    riskPolicyVersions: staged.riskPolicyVersions,
    monthlyRiskLimits: staged.monthlyRiskLimits,
    riskOverrideEvents: staged.riskOverrideEvents,
    liveStatsStartTradingDayKey: currentStage.startsOn,
    livePerformanceCycles: compatibilityCycles,
    weeklyReviews: staged.weeklyReviews,
    quickNotes: staged.quickNotes,
    strategies: staged.strategies,
    starredIds: staged.starredIds,
    subscribedIds: staged.subscribedIds,
    pinnedStrategyIds: staged.pinnedStrategyIds,
    display: staged.display,
    shortcuts,
    tagPresets: staged.tagPresets,
    mistakeTagPresets: staged.mistakeTagPresets,
    profile: staged.profile,
    savedTradeViews: staged.savedTradeViews,
    symbolIcons: staged.symbolIcons,
    symbolCatalog: staged.symbolCatalog,
    reviewTemplates: staged.reviewTemplates,
  }
}

const controller = new PersistenceController({
  async saveSnapshot(snapshot) {
    try {
      await getStorage().saveSnapshot(snapshot)
    } catch (error) {
      console.error('Persist failed', error)
      throw error
    }
  },
  captureSnapshot() {
    const state = useStore.getState()
    const shortcutBindings = useShortcutStore.getState().bindings
    return {
      snapshot: pickPersisted(state, shortcutBindings),
      stateReference: state,
      shortcutReference: shortcutBindings,
    }
  },
  status: {
    getStatus: () => useSaveStatus.getState().status,
    setDirty: () => useSaveStatus.getState().setDirty(),
    setSaving: () => useSaveStatus.getState().setSaving(),
    setSaved: () => useSaveStatus.getState().setSaved(),
    setError: (error) => useSaveStatus.getState().setError(error),
    reset: () => useSaveStatus.getState().reset(),
  },
  clock: {
    setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
})

export function setPreFlushCallback(callback: (() => Promise<void>) | null): void {
  controller.setPreFlushCallback(callback)
}

export function enablePersistWrites(): void {
  controller.enableWrites()
}

export function disablePersistWrites(): void {
  controller.disableWrites()
}

export function hasPendingChanges(): boolean {
  return controller.hasPendingChanges()
}

export function schedulePersist(snapshot: PersistedSnapshot): void {
  controller.schedule(snapshot)
}

export function suspendPersist(): void {
  controller.suspend()
}

export function resumePersist(options?: { flushNow?: boolean }): void {
  controller.resume(options)
}

export function discardPendingAndResumePersist(): void {
  controller.discardPendingAndResume()
}

export async function resumePersistAndFlush(): Promise<void> {
  await controller.resumeAndFlush()
}

export async function withPersistSuspended<T>(fn: () => T | Promise<T>): Promise<T> {
  suspendPersist()
  try {
    return await Promise.resolve(fn())
  } finally {
    await resumePersistAndFlush()
  }
}

export function getPersistSuspendDepth(): number {
  return controller.getSuspendDepth()
}

export function getPersistenceDiagnostics(): PersistenceDiagnostics {
  return controller.getDiagnostics()
}

export function resetPersistenceDiagnostics(): void {
  controller.resetDiagnostics()
}

export async function flushPersistNow(): Promise<void> {
  await controller.flushNow()
}

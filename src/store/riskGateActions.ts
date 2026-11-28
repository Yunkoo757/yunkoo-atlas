import { assertValidLiveStageState } from '@/lib/liveStages'
import { getTradingDayKey } from '@/lib/periods'
import type { RiskGatedTradeOpenCommitResult } from '@/lib/riskGatedTradeOpenCommit'
import type { StorePendingTradeOpenRequest, useStore } from './useStore'

/** 每个待确认请求只提交一次，失败后可以在同一请求上重试。 */
export function createRiskGateActions(store: Pick<typeof useStore, 'getState' | 'setState'>) {
  const { getState: get, setState: set } = store
  const confirmations = new WeakMap<StorePendingTradeOpenRequest, Promise<RiskGatedTradeOpenCommitResult>>()

  async function commit(
    request: StorePendingTradeOpenRequest,
    librarySession: number,
    reason: string,
  ): Promise<RiskGatedTradeOpenCommitResult> {
    const [{ commitRiskGatedTradeOpen }, { pickPersisted }, { useShortcutStore }] = await Promise.all([
      import('@/lib/riskGatedTradeOpenCommit'),
      import('@/storage/snapshotProjection'),
      import('@/store/shortcutStore'),
    ])
    if (get().pendingTradeOpenRequest !== request || get().librarySession !== librarySession) {
      return { kind: 'cancelled', reason: 'target-no-longer-eligible' }
    }
    const result = await commitRiskGatedTradeOpen({
      request,
      reason,
      captureLatestState: () => {
        const state = get()
        return {
          state,
          snapshot: pickPersisted(
            state,
            useShortcutStore.getState().bindings,
          ),
          currentTradingDayKey: getTradingDayKey(
            new Date(),
            state.display.tradingDayStartHour,
          ),
        }
      },
      isCurrentSession: () => get().librarySession === librarySession,
      publish: ({ trades, riskOverrideEvents }) => {
        set(current => ({
          trades,
          riskOverrideEvents,
          pendingTradeOpenRequest: current.pendingTradeOpenRequest === request ? null : current.pendingTradeOpenRequest,
        }))
        return pickPersisted(get(), useShortcutStore.getState().bindings)
      },
    })
    if (get().pendingTradeOpenRequest !== request || get().librarySession !== librarySession) return result
    if (result.kind === 'cancelled') {
      set({ pendingTradeOpenRequest: null })
    } else if (result.kind === 'needs-reconfirmation') {
      set({ pendingTradeOpenRequest: null })
      get().requestTradeOpen(request.tradeId, request.returnFocus)
    }
    return result
  }

  return {
    async confirmTradeOpen(rawReason: string): Promise<RiskGatedTradeOpenCommitResult> {
      const reason = rawReason.trim()
      if (reason.length > 500) throw new Error('继续开仓原因最多 500 字')
      const { pendingTradeOpenRequest: request, librarySession } = get()
      if (!request) return { kind: 'cancelled', reason: 'target-missing' }
      const active = confirmations.get(request)
      if (active) return active
      const operation = commit(request, librarySession, reason)
      confirmations.set(request, operation)
      try {
        return await operation
      } finally {
        confirmations.delete(request)
      }
    },
    async rehydrateRiskGateFromStorage(): Promise<void> {
      const session = get().librarySession
      const { getStorage } = await import('@/storage/provider')
      if (get().librarySession !== session) return
      const snapshot = await getStorage().loadSnapshot()
      if (get().librarySession !== session) return
      if (!snapshot) throw new Error('存储中没有可恢复的风险开仓快照')
      assertValidLiveStageState(snapshot)
      set({
        trades: snapshot.trades,
        liveStages: snapshot.liveStages,
        currentLiveStageId: snapshot.currentLiveStageId,
        scheduledStageRollover: snapshot.scheduledStageRollover,
        weeklyRiskPreparations: snapshot.weeklyRiskPreparations,
        riskPolicyVersions: snapshot.riskPolicyVersions,
        monthlyRiskLimits: snapshot.monthlyRiskLimits,
        riskOverrideEvents: snapshot.riskOverrideEvents,
        pendingTradeOpenRequest: null,
        riskSetupTradeOpenRequest: null,
      })
    },
  }
}

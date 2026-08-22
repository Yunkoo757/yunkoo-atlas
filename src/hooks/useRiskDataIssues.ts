import { useMemo } from 'react'
import type { RiskDataIssue } from '@/data/riskManagement'
import { resolveRiskDataIssues } from '@/lib/riskBudget'
import { useStore } from '@/store/useStore'
import { getCurrentLiveStage } from '@/lib/liveStages'

export function useRiskDataIssues(currentTradingDayKey: string): RiskDataIssue[] {
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const currentStage = getCurrentLiveStage(liveStages, currentLiveStageId)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)

  return useMemo(() => resolveRiskDataIssues({
    trades,
    policies,
    monthlyLimits,
    liveStageId: currentStage.id,
    liveStageStartsOn: currentStage.startsOn,
    currentTradingDayKey,
    tradingDayStartHour,
  }), [trades, policies, monthlyLimits, currentStage.id, currentStage.startsOn, currentTradingDayKey, tradingDayStartHour])
}

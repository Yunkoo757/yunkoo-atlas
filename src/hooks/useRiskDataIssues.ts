import { useMemo } from 'react'
import type { RiskDataIssue } from '@/data/riskManagement'
import { resolveRiskDataIssues } from '@/lib/riskBudget'
import { useStore } from '@/store/useStore'

export function useRiskDataIssues(currentTradingDayKey: string): RiskDataIssue[] {
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const liveStatsStartTradingDayKey = useStore((state) => state.liveStatsStartTradingDayKey)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)

  return useMemo(() => resolveRiskDataIssues({
    trades,
    policies,
    monthlyLimits,
    currentTradingDayKey,
    liveStatsStartTradingDayKey,
    tradingDayStartHour,
  }), [trades, policies, monthlyLimits, currentTradingDayKey, liveStatsStartTradingDayKey, tradingDayStartHour])
}

import { AlertCircle, CalendarDays } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { fmtDate } from '@/lib/format'
import { getCurrentLiveStage } from '@/lib/liveStages'
import { listCurrentStageLiveTrades, listStageRolloverAdvisories, listStageRolloverBlockers } from '@/lib/stageRollover'
import { useStore } from '@/store/useStore'
import './StageRolloverBanner.css'

export function StageRolloverBanner({
  currentTradingDayKey: currentTradingDayKeyOverride,
}: {
  currentTradingDayKey?: string
} = {}) {
  const currentTradingDayKey = useLocalDateKey()
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const scheduled = useStore((state) => state.scheduledStageRollover)
  const trades = useStore((state) => state.trades)
  const weeklyReviews = useStore((state) => state.weeklyReviews)
  const riskPolicyVersions = useStore((state) => state.riskPolicyVersions)
  if (!scheduled) return null

  const currentStage = getCurrentLiveStage(liveStages, currentLiveStageId)
  const blockers = listStageRolloverBlockers({
    liveStages,
    currentLiveStageId,
    scheduledStageRollover: scheduled,
    trades,
    weeklyReviews,
    riskPolicyVersions,
  }, scheduled.effectiveWeekStart)
  const blockerCodes = new Set(blockers.map((blocker) => blocker.code))
  const advisories = listStageRolloverAdvisories({
    liveStages,
    currentLiveStageId,
    scheduledStageRollover: scheduled,
    trades,
    weeklyReviews,
    riskPolicyVersions,
  }, scheduled.effectiveWeekStart)
  const advisoryCodes = new Set(advisories.map((advisory) => advisory.code))
  const currentLiveTrades = listCurrentStageLiveTrades(trades, currentStage.id)
  const plannedCount = currentLiveTrades.filter((trade) => trade.status === 'planned').length
  const openCount = currentLiveTrades.filter((trade) => trade.status === 'open').length
  const effectiveDay = fmtDate(scheduled.effectiveWeekStart)
  const due = (currentTradingDayKeyOverride ?? currentTradingDayKey) >= scheduled.effectiveWeekStart

  return (
    <section
      className={`stage-rollover-banner${blockers.length > 0 ? ' has-blockers' : ''}`}
      data-stage-rollover-banner
      role="status"
      aria-live="polite"
    >
      <div className="stage-rollover-banner-icon" aria-hidden>
        {blockers.length > 0 ? <AlertCircle size={ICON_MD} /> : <CalendarDays size={ICON_MD} />}
      </div>
      <div className="stage-rollover-banner-copy">
        <div className="stage-rollover-banner-title">
          <strong>{scheduled.postponedCount > 0
            ? `阶段切换已顺延至 ${effectiveDay}`
            : `已预约 ${effectiveDay} 开启新实盘阶段`}</strong>
          <span>{currentStage.name}</span>
        </div>
        {blockers.length > 0 || advisoryCodes.has('planned-trades') || advisoryCodes.has('weekly-review-incomplete') ? <div className="stage-rollover-banner-detail">
          {advisoryCodes.has('planned-trades') ? <span className="stage-rollover-banner-note">计划中 {plannedCount} 笔将保留在原阶段</span> : null}
          {blockerCodes.has('open-trades') ? <span className="stage-rollover-banner-note">持仓中 {openCount} 笔</span> : null}
          {advisoryCodes.has('weekly-review-incomplete') ? <span className="stage-rollover-banner-note">周复盘可稍后补做</span> : null}
        </div> : null}
        {scheduled.postponedCount > 0 ? (
          <p>{blockers.length > 0 ? '处理阻断项后将在新的生效日重试。' : '将在新的生效日重试。'}</p>
        ) : null}
      </div>
    </section>
  )
}

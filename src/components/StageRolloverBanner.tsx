import { AlertCircle, CalendarDays, CheckCircle } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { fmtDate } from '@/lib/format'
import { getCurrentLiveStage } from '@/lib/liveStages'
import { listStageRolloverBlockers } from '@/lib/stageRollover'
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
  const plannedCount = trades.filter((trade) =>
    !trade.deletedAt && trade.tradeKind === 'live' && trade.liveStageId === currentStage.id && trade.status === 'planned',
  ).length
  const openCount = trades.filter((trade) =>
    !trade.deletedAt && trade.tradeKind === 'live' && trade.liveStageId === currentStage.id && trade.status === 'open',
  ).length
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
        {blockers.length > 0 ? <AlertCircle size={ICON_MD} /> : <CheckCircle size={ICON_MD} />}
      </div>
      <div className="stage-rollover-banner-copy">
        <div className="stage-rollover-banner-title">
          <strong>{scheduled.postponedCount > 0
            ? `阶段切换已顺延至 ${effectiveDay}`
            : `已预约 ${effectiveDay} 开启新实盘阶段`}</strong>
          <span>{currentStage.name}</span>
        </div>
        <div className="stage-rollover-banner-detail">
          <CalendarDays size={ICON_MD} aria-hidden />
          <span>{due ? '正在按最新资料检查生效条件' : '预约期间当前阶段继续正常使用'}</span>
          {blockerCodes.has('planned-trades') ? <span className="stage-rollover-banner-chip">计划中 {plannedCount} 笔</span> : null}
          {blockerCodes.has('open-trades') ? <span className="stage-rollover-banner-chip">持仓中 {openCount} 笔</span> : null}
          {blockerCodes.has('weekly-review-incomplete') ? <span className="stage-rollover-banner-chip">当前阶段周复盘尚未完成</span> : null}
          {blockers.length === 0 ? <span className="stage-rollover-banner-clear">当前无业务阻断项</span> : null}
        </div>
        {scheduled.postponedCount > 0 ? (
          <p>预约不会自动取消；处理全部阻断项后，系统将在新的生效日再次检查。</p>
        ) : null}
      </div>
    </section>
  )
}

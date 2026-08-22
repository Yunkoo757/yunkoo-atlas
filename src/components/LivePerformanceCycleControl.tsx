import { Link } from 'react-router-dom'
import { fmtDate } from '@/lib/format'
import { getCurrentLiveStage } from '@/lib/liveStages'
import { useStore } from '@/store/useStore'
import './LivePerformanceCycleControl.css'

type LivePerformanceCycleControlProps = {
  onManage: () => void
}

export function LivePerformanceCycleControl({
  onManage,
}: LivePerformanceCycleControlProps) {
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const scheduled = useStore((state) => state.scheduledStageRollover)
  const currentStage = getCurrentLiveStage(liveStages, currentLiveStageId)
  return (
    <div className="live-performance-cycle-control">
      <span className="live-performance-cycle-current">
        <strong>{currentStage.name}</strong>
        <span>始于 {fmtDate(currentStage.startsOn)}</span>
        {scheduled ? <span>· 已预约 {fmtDate(scheduled.effectiveWeekStart)}</span> : null}
      </span>
      <Link
        to="/list?kind=live&range=all&liveStage=current"
        className="live-performance-cycle-action"
        data-current-live-trade-link
      >
        查看当前实盘
      </Link>
      <button
        type="button"
        className="live-performance-cycle-action"
        aria-haspopup="dialog"
        onClick={onManage}
      >
        开启新实盘阶段
      </button>
    </div>
  )
}

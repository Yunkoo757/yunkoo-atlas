import { Link } from 'react-router-dom'
import './LivePerformanceCycleControl.css'

type LivePerformanceCycleControlProps = {
  onManage: () => void
}

export function LivePerformanceCycleControl({
  onManage,
}: LivePerformanceCycleControlProps) {
  return (
    <div className="live-performance-cycle-control">
      <span className="live-performance-cycle-current">
        <strong>当前实盘统计</strong>
      </span>
      <Link
        to="/list?kind=live&range=all"
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
        开启新一轮
      </button>
    </div>
  )
}

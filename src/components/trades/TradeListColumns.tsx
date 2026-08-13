import './TradeList.css'

export function TradeListColumns({ className = '' }: { className?: string }) {
  return (
    <div className={`trade-list-columns${className ? ` ${className}` : ''}`} role="row">
      <span className="trade-list-column is-check" role="columnheader" aria-label="选择" />
      <span className="trade-list-column is-status" role="columnheader" aria-label="状态" />
      <span className="trade-list-column is-ref" role="columnheader">编号</span>
      <span className="trade-list-column is-identity" role="columnheader">交易</span>
      <span className="trade-list-column is-tags" role="columnheader">策略 / 标签</span>
      <span className="trade-list-column is-timeframe" role="columnheader">周期</span>
      <span className="trade-list-column is-pnl" role="columnheader">盈亏</span>
      <span className="trade-list-column is-r" role="columnheader">R</span>
      <span className="trade-list-column is-date" role="columnheader">日期</span>
      <span className="trade-list-column is-end" role="columnheader" aria-label="星标" />
    </div>
  )
}

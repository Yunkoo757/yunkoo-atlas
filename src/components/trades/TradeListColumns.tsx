import './TradeList.css'

export function TradeListColumns({ className = '' }: { className?: string }) {
  return (
    <div className={`trade-list-columns${className ? ` ${className}` : ''}`} aria-hidden="true">
      <span className="trade-list-column is-check" />
      <span className="trade-list-column is-status" />
      <span className="trade-list-column is-ref">编号</span>
      <span className="trade-list-column is-identity">交易</span>
      <span className="trade-list-column is-tags">策略 / 标签</span>
      <span className="trade-list-column is-timeframe">周期</span>
      <span className="trade-list-column is-pnl">盈亏</span>
      <span className="trade-list-column is-r">R</span>
      <span className="trade-list-column is-date">日期</span>
      <span className="trade-list-column is-end" />
    </div>
  )
}

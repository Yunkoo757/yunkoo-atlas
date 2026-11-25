import { ICON_LG, ICON_MD } from '@/icons/iconSize'
import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { fmtMoney, fmtR, fmtDate } from '@/lib/format'
import { formatTradeCashPnl } from '@/lib/cashCurrency'
import { getStrategyName } from '@/lib/strategies'
import type { buildDashboardStats } from '@/lib/dashboardStats'
import { STATUS_META, CONVICTION_META } from '@/data/trades'
import { PreviewHeader, PreviewMeta } from '@/components/HoverPreview'
import { StrategyIcon } from '@/components/StrategyIcon'
import { StatusIcon } from '@/components/StatusIcon'
import { useStore } from '@/store/useStore'
import './RowPreviews.css'

export type StrategyPreviewStats = ReturnType<typeof buildDashboardStats>['strategies'][number]

/** 交易行悬浮预览 */
export function TradePreview({
  trade,
  strategies,
}: {
  trade: Trade
  strategies: Strategy[]
}) {
  const privacyMode = useStore((state) => state.display.privacyMode)
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const statusMeta = STATUS_META[trade.status]
  const convictionMeta = CONVICTION_META[trade.conviction]
  const strategyName = getStrategyName(strategies, trade.strategyId)

  return (
    <div className="rp-card">
      <PreviewHeader
        icon={<StatusIcon status={trade.status} size={ICON_LG} />}
        title={`${trade.symbol} ${trade.side === 'long' ? '多' : trade.side === 'short' ? '空' : ''}`}
        subtitle={strategyName}
      />
      <div className="rp-divider" />
      <PreviewMeta>
        <div className="rp-meta-grid">
          <span className="rp-meta-item">
            <span className="rp-meta-label">状态</span>
            <span>{statusMeta.label}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">信心</span>
            <span>{convictionMeta.label}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">开仓</span>
            <span>{fmtDate(trade.openedAt)}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">盈亏</span>
            <span>{formatTradeCashPnl(trade, legacyCashCurrencyAssumption, privacyMode)}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">R</span>
            <span>{fmtR(trade.rMultiple)}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">编号</span>
            <span>{trade.ref}</span>
          </span>
        </div>
      </PreviewMeta>
      {trade.note && (
        <>
          <div className="rp-divider" />
          <p className="rp-note">{trade.note.replace(/<[^>]+>/g, '').slice(0, 120)}</p>
        </>
      )}
      {trade.tags && trade.tags.length > 0 && (
        <div className="rp-tags">
          {trade.tags.slice(0, 4).map((t) => (
            <span className="rp-tag" key={t}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 策略胶囊悬浮统计：仅展示实盘中可信的已平结果。 */
export function StrategyPreview({
  strategyId,
  strategies,
  stats,
}: {
  strategyId: string
  strategies: Strategy[]
  stats: StrategyPreviewStats | null
}) {
  const privacyMode = useStore((state) => state.display.privacyMode)
  const strategy = strategies.find((item) => item.id === strategyId)
  const strategyName = strategy?.name ?? stats?.name ?? '未分类'

  const empty = !stats || stats.n === 0
  const summary = empty
    ? (stats?.closedCount ? `已平仓 ${stats.closedCount} 笔，结果待核对` : '暂无已平仓的实盘交易')
    : [
      `盈利 ${stats.wins}`,
      `亏损 ${stats.losses}`,
      stats.breakevens > 0 ? `保本 ${stats.breakevens}` : null,
    ].filter(Boolean).join(' · ')

  return (
    <div className="sp-card">
      <PreviewHeader
        icon={strategy ? <StrategyIcon icon={strategy.icon} color={strategy.color} size={ICON_MD} /> : undefined}
        title={strategyName}
        subtitle={summary}
      />
      {!empty && (
        <dl className="sp-summary">
          <div>
            <dt>净盈亏</dt>
            <dd className={stats.pnl > 0 ? 'is-positive' : stats.pnl < 0 ? 'is-negative' : undefined}>
              {stats.pnlCount ? fmtMoney(stats.pnl, 'USD', privacyMode) : '—'}
            </dd>
          </div>
          <div>
            <dt>胜率</dt>
            <dd>{stats.winRate === null ? '—' : `${stats.winRate.toFixed(0)}%`}</dd>
          </div>
          <div>
            <dt>平均 R</dt>
            <dd>{stats.rCount ? fmtR(stats.averageR) : '—'}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}

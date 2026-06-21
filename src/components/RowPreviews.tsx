import type { Trade, TradeStatus } from '@/data/trades'
import type { CaseRecord, DisputeType } from '@/data/case'
import type { Strategy } from '@/data/strategies'
import { fmtMoney, fmtR, fmtDate } from '@/lib/format'
import { getStrategyName } from '@/lib/strategies'
import { STATUS_META, CONVICTION_META } from '@/data/trades'
import { deriveOutcome, formatCaseId, getDisputeType, OUTCOME_COLORS } from '@/data/case'
import { PreviewHeader, PreviewMeta } from '@/components/HoverPreview'
import './RowPreviews.css'

/** 交易行悬浮预览 */
export function TradePreview({
  trade,
  strategies,
}: {
  trade: Trade
  strategies: Strategy[]
}) {
  const statusMeta = STATUS_META[trade.status]
  const convictionMeta = CONVICTION_META[trade.conviction]
  const strategyName = getStrategyName(strategies, trade.strategyId)

  return (
    <div className="rp-card">
      <PreviewHeader
        icon={
          <span className="rp-status-ring" data-status={trade.status}>
            {statusMeta.label.charAt(0)}
          </span>
        }
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
            <span className="rp-meta-label">入场</span>
            <span>{trade.entry > 0 ? trade.entry.toFixed(trade.entry < 1 ? 4 : 2) : '—'}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">出场</span>
            <span>{trade.exit ? trade.exit.toFixed(trade.exit < 1 ? 4 : 2) : '—'}</span>
          </span>
          {trade.pnl !== 0 && (
            <span className="rp-meta-item">
              <span className="rp-meta-label">盈亏</span>
              <span className={trade.pnl > 0 ? 'rp-pos' : 'rp-neg'}>
                {fmtMoney(trade.pnl)} · {fmtR(trade.rMultiple)}
              </span>
            </span>
          )}
          <span className="rp-meta-item">
            <span className="rp-meta-label">日期</span>
            <span>{fmtDate(trade.openedAt)}</span>
          </span>
        </div>
      </PreviewMeta>
      {trade.note && (
        <>
          <div className="rp-divider" />
          <p className="rp-note">{trade.note.replace(/<[^>]+>/g, '').slice(0, 120)}</p>
        </>
      )}
      {trade.tags.length > 0 && (
        <div className="rp-tags">
          {trade.tags.slice(0, 4).map((t) => (
            <span className="rp-tag" key={t}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 判例行悬浮预览 */
export function CasePreview({
  rec,
  disputeTypes,
}: {
  rec: CaseRecord
  disputeTypes: DisputeType[]
}) {
  const dt = getDisputeType(rec.disputeTypeId, disputeTypes)
  const outcome = deriveOutcome(rec, dt)
  const colors = OUTCOME_COLORS[outcome]
  const caseId = formatCaseId(rec.id)

  return (
    <div className="rp-card">
      <PreviewHeader
        icon={<span className="rp-status-ring" style={{ background: colors.bg, color: colors.dot }}>判</span>}
        title={caseId}
        subtitle={dt?.name ?? '未知类型'}
      />
      <div className="rp-divider" />
      <PreviewMeta>
        <div className="rp-meta-grid">
          <span className="rp-meta-item">
            <span className="rp-meta-label">初始裁决</span>
            <span>{rec.initialVerdict}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">结果</span>
            <span style={{ color: colors.dot }}>{colors.label}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">信心</span>
            <span>{rec.confidence}%</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">截图</span>
            <span>{rec.images.length} 张</span>
          </span>
          {rec.finalVerdict && (
            <span className="rp-meta-item">
              <span className="rp-meta-label">最终裁决</span>
              <span>{rec.finalVerdict}</span>
            </span>
          )}
        </div>
      </PreviewMeta>
      {rec.note && (
        <>
          <div className="rp-divider" />
          <p className="rp-note">{rec.note.slice(0, 120)}</p>
        </>
      )}
      {rec.tags && rec.tags.length > 0 && (
        <div className="rp-tags">
          {rec.tags.slice(0, 4).map((t) => (
            <span className="rp-tag" key={t}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

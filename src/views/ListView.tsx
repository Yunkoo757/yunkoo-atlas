import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Topbar } from '@/components/Topbar'
import { EmptyState } from '@/components/EmptyState'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { useStore } from '@/store/useStore'
import { STATUS_META, type TradeStatus, type Trade } from '@/data/trades'
import { fmtMoney, fmtR, fmtDate } from '@/lib/format'
import './ListView.css'

const ORDER: TradeStatus[] = ['planned', 'open', 'win', 'breakeven', 'loss']

export function ListView({
  view,
  onView,
}: {
  view: 'list' | 'board'
  onView: (v: 'list' | 'board') => void
}) {
  const trades = useStore((s) => s.trades)
  const openComposer = useStore((s) => s.openComposer)
  const setStatus = useStore((s) => s.setStatus)
  const removeTrade = useStore((s) => s.removeTrade)
  const [ctx, setCtx] = useState<CtxState | null>(null)

  const onRowContext = (e: React.MouseEvent, t: Trade) => {
    e.preventDefault()
    setCtx({
      x: e.clientX,
      y: e.clientY,
      items: buildTradeCtxItems(t, { setStatus, openComposer, removeTrade }),
    })
  }

  const groups = useMemo(() => {
    const map = new Map<TradeStatus, Trade[]>()
    ORDER.forEach((s) => map.set(s, []))
    trades.forEach((t) => map.get(t.status)!.push(t))
    return ORDER.map((s) => ({ status: s, items: map.get(s)! })).filter(
      (g) => g.items.length > 0,
    )
  }, [trades])

  let rowIndex = 0

  return (
    <>
      <Topbar title="交易" view={view} onView={onView} />
      <div className="list-scroll">
        {groups.length === 0 ? (
          <EmptyState
            title="还没有交易"
            hint="记录你的第一笔交易，开始构建你的复盘日志。"
            action={
              <button className="empty-btn" onClick={() => openComposer()}>
                <Plus size={15} />
                <span>新建交易</span>
              </button>
            }
          />
        ) : (
          groups.map((g) => (
            <section key={g.status} className="lv-group">
              <div className="lv-group-header">
                <StatusIcon status={g.status} size={15} />
                <span className="lv-group-title">{STATUS_META[g.status].label}</span>
                <span className="lv-group-count">{g.items.length}</span>
                <button className="lv-group-add" title="新建交易" onClick={() => openComposer()}>
                  <Plus size={15} />
                </button>
              </div>
              {g.items.map((t) => (
                <Row key={t.id} t={t} index={rowIndex++} onContext={onRowContext} />
              ))}
            </section>
          ))
        )}
      </div>
      <ContextMenu state={ctx} onClose={() => setCtx(null)} />
    </>
  )
}

function Row({
  t,
  index,
  onContext,
}: {
  t: Trade
  index: number
  onContext: (e: React.MouseEvent, t: Trade) => void
}) {
  return (
    <Link
      to={`/trade/${t.id}`}
      className="lv-row"
      style={{ animationDelay: `${Math.min(index, 16) * 22}ms` }}
      onContextMenu={(e) => onContext(e, t)}
    >
      <span className="lv-check">
        <span className="lv-check-box" />
      </span>
      <ConvictionIcon conviction={t.conviction} />
      <StatusIcon status={t.status} />
      <span className="lv-ref">{t.ref}</span>
      <span className="lv-symbol">{t.symbol}</span>
      <SideTag side={t.side} />
      <span className="lv-title">{t.strategy}</span>
      <div className="lv-spacer" />
      <div className="lv-tags">
        {t.tags.map((tag) => (
          <span className="lv-tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
      <span
        className="lv-pnl"
        style={{ color: t.pnl > 0 ? 'var(--pos)' : t.pnl < 0 ? 'var(--neg)' : 'var(--text-tertiary)' }}
      >
        {t.status === 'planned' ? '—' : fmtMoney(t.pnl)}
      </span>
      <span className="lv-r">{t.status === 'planned' ? '' : fmtR(t.rMultiple)}</span>
      <span className="lv-avatar">Y</span>
      <span className="lv-date">{fmtDate(t.openedAt)}</span>
    </Link>
  )
}

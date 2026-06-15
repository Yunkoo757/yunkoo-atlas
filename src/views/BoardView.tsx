import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Topbar } from '@/components/Topbar'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { useStore } from '@/store/useStore'
import { STATUS_META, type TradeStatus, type Trade } from '@/data/trades'
import { fmtMoney, fmtR } from '@/lib/format'
import './BoardView.css'

const ORDER: TradeStatus[] = ['planned', 'open', 'win', 'breakeven', 'loss']

export function BoardView({
  view,
  onView,
  onOpen,
}: {
  view: 'list' | 'board'
  onView: (v: 'list' | 'board') => void
  onOpen: (id: string) => void
}) {
  const trades = useStore((s) => s.trades)
  const setStatus = useStore((s) => s.setStatus)
  const openComposer = useStore((s) => s.openComposer)
  const removeTrade = useStore((s) => s.removeTrade)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<TradeStatus | null>(null)
  const [ctx, setCtx] = useState<CtxState | null>(null)

  const cols = useMemo(() => {
    const map = new Map<TradeStatus, Trade[]>()
    ORDER.forEach((s) => map.set(s, []))
    trades.forEach((t) => map.get(t.status)!.push(t))
    return ORDER.map((s) => ({ status: s, items: map.get(s)! }))
  }, [trades])

  return (
    <>
      <Topbar title="交易" view={view} onView={onView} />
      <div className="board-scroll">
        {cols.map((c) => (
          <div
            key={c.status}
            className={'bd-col' + (overCol === c.status ? ' is-over' : '')}
            onDragOver={(e) => {
              e.preventDefault()
              setOverCol(c.status)
            }}
            onDragLeave={() => setOverCol((p) => (p === c.status ? null : p))}
            onDrop={() => {
              if (dragId) setStatus(dragId, c.status)
              setDragId(null)
              setOverCol(null)
            }}
          >
            <div className="bd-col-header">
              <StatusIcon status={c.status} size={15} />
              <span className="bd-col-title">{STATUS_META[c.status].label}</span>
              <span className="bd-col-count">{c.items.length}</span>
              <button className="bd-col-add" title="新建交易" onClick={() => openComposer()}>
                <Plus size={15} />
              </button>
            </div>
            <div className="bd-col-body">
              {c.items.map((t, i) => (
                <article
                  key={t.id}
                  className={'bd-card' + (dragId === t.id ? ' is-dragging' : '')}
                  style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => onOpen(t.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setCtx({
                      x: e.clientX,
                      y: e.clientY,
                      items: buildTradeCtxItems(t, { setStatus, openComposer, removeTrade }),
                    })
                  }}
                >
                  <div className="bd-card-top">
                    <span className="bd-card-ref">{t.ref}</span>
                    <ConvictionIcon conviction={t.conviction} />
                  </div>
                  <div className="bd-card-title">
                    <span className="bd-card-symbol">{t.symbol}</span>
                    <SideTag side={t.side} />
                  </div>
                  <div className="bd-card-strategy">{t.strategy}</div>
                  <div className="bd-card-foot">
                    <span
                      style={{
                        color:
                          t.pnl > 0
                            ? 'var(--pos)'
                            : t.pnl < 0
                              ? 'var(--neg)'
                              : 'var(--text-tertiary)',
                      }}
                    >
                      {t.status === 'planned' ? '—' : fmtMoney(t.pnl)}
                    </span>
                    {t.status !== 'planned' && (
                      <span className="bd-card-r">{fmtR(t.rMultiple)}</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
      <ContextMenu state={ctx} onClose={() => setCtx(null)} />
    </>
  )
}

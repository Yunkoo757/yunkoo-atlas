import { useMemo, useState } from 'react'
import { Plus, Bell } from 'lucide-react'
import { Topbar } from '@/components/Topbar'
import { EmptyState } from '@/components/EmptyState'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { StrategyLabel } from '@/components/StrategyIcon'
import { getStrategyName } from '@/lib/strategies'
import { useStore } from '@/store/useStore'
import { STATUS_META, type TradeStatus, type Trade } from '@/data/trades'
import {
  filterTrades,
  applyDisplayPrefs,
  type ListFilter,
} from '@/lib/tradeFilters'
import { fmtMoney, fmtR } from '@/lib/format'
import { toast } from '@/lib/toast'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import { getTradesPageSubtitle } from '@/lib/pageCopy'
import { useListContextSync } from '@/shortcuts/useListContextSync'
import './BoardView.css'

export function BoardView({
  title = '交易',
  view,
  onView,
  onOpen,
  filter = { type: 'all' },
}: {
  title?: string
  view: 'list' | 'board'
  onView: (v: 'list' | 'board') => void
  onOpen: (id: string) => void
  filter?: ListFilter
}) {
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const display = useStore((s) => s.display)
  const starredIds = useStore((s) => s.starredIds)
  const subscribedIds = useStore((s) => s.subscribedIds)
  const updateTradeData = useStore((s) => s.updateTradeData)
  const setStatus = useStore((s) => s.setStatus)
  const openComposer = useStore((s) => s.openComposer)
  const removeTrade = useStore((s) => s.removeTrade)
  const toggleStar = useStore((s) => s.toggleStar)
  const isStarred = useStore((s) => s.isStarred)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<TradeStatus | null>(null)
  const [ctx, setCtx] = useState<CtxState | null>(null)

  useListContextSync(filter)

  const visible = useMemo(() => {
    const filtered = filterTrades(trades, filter, starredIds)
    return applyDisplayPrefs(filtered, display, filter)
  }, [trades, filter, starredIds, display])

  const cols = useMemo(() => {
    const map = new Map<TradeStatus, Trade[]>()
    STATUS_ORDER.forEach((s) => map.set(s, []))
    visible.forEach((t) => {
      if (!map.has(t.status)) map.set(t.status, [])
      map.get(t.status)!.push(t)
    })
    return STATUS_ORDER.map((s) => ({ status: s, items: map.get(s) ?? [] })).filter(
      (c) => display.showEmptyGroups || c.items.length > 0,
    )
  }, [visible, display.showEmptyGroups])

  const emptyHint =
    filter.type === 'active'
      ? '暂无进行中的交易（计划中或持仓中）。'
      : filter.type === 'starred'
          ? '还没有星标交易。'
          : '当前筛选下没有交易。'

  const subtitle = getTradesPageSubtitle(filter)

  const transition = { updateTradeData, setStatus, toast }

  const onDropToColumn = (status: TradeStatus) => {
    if (!dragId) return
    const trade = trades.find((t) => t.id === dragId)
    if (trade) transitionTradeStatus(trade, status, transition)
    setDragId(null)
    setOverCol(null)
  }

  return (
    <>
      <Topbar title={title} subtitle={subtitle} view={view} onView={onView} />
      <div className="board-scroll">
        {cols.length === 0 ? (
          <EmptyState title="没有交易" hint={emptyHint} />
        ) : (
          cols.map((c) => (
            <div
              key={c.status}
              className={'bd-col' + (overCol === c.status ? ' is-over' : '')}
              onDragOver={(e) => {
                e.preventDefault()
                setOverCol(c.status)
              }}
              onDragLeave={() => setOverCol((p) => (p === c.status ? null : p))}
              onDrop={() => onDropToColumn(c.status)}
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
                        items: buildTradeCtxItems(t, {
                          setStatus,
                          changeStatus: (s) => transitionTradeStatus(t, s, transition),
                          openComposer,
                          removeTrade,
                          toggleStar,
                          isStarred,
                        }),
                      })
                    }}
                  >
                    <div className="bd-card-top">
                      <span className="bd-card-ref">{t.ref}</span>
                      {subscribedIds.includes(t.id) && (
                        <Bell size={12} className="bd-card-followed" aria-label="已置顶关注" />
                      )}
                      <ConvictionIcon conviction={t.conviction} />
                    </div>
                    <div className="bd-card-title">
                      <span className="bd-card-symbol">{t.symbol}</span>
                      <SideTag side={t.side} />
                    </div>
                    <div className="bd-card-strategy">
                      <StrategyLabel strategyId={t.strategyId} strategies={strategies} size={13} />
                    </div>
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
                        {t.status === 'planned' || t.status === 'open'
                          ? '—'
                          : fmtMoney(t.pnl)}
                      </span>
                      {t.status !== 'planned' && t.status !== 'open' && (
                        <span className="bd-card-r">{fmtR(t.rMultiple)}</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <ContextMenu state={ctx} onClose={() => setCtx(null)} />
    </>
  )
}

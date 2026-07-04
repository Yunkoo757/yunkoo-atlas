import React, { useMemo, useState } from 'react'
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
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
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
  const trades = useStore((s) => s.trades).filter((t) => !t.deletedAt)
  const strategies = useStore((s) => s.strategies)
  const display = useStore((s) => s.display)
  const starredIds = useStore((s) => s.starredIds)
  const subscribedIds = useStore((s) => s.subscribedIds)
  const updateTradeData = useStore((s) => s.updateTradeData)
  const setStatus = useStore((s) => s.setStatus)
  const openComposer = useStore((s) => s.openComposer)
  const removeTrade = useStore((s) => s.removeTrade)
  const upsertTrade = useStore((s) => s.upsertTrade)
  const toggleStar = useStore((s) => s.toggleStar)
  const isStarred = useStore((s) => s.isStarred)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<TradeStatus | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [dragImg, setDragImg] = useState<HTMLImageElement | null>(null)
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
  const isReviewCaseView = filter.tradeKind === 'case'
  const recordLabel = isReviewCaseView ? '案例记录' : '交易'

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
          <EmptyState title={isReviewCaseView ? '没有案例记录' : '没有交易'} hint={emptyHint} />
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
                <button className="bd-col-add" title={`新建${recordLabel}`} onClick={() => openComposer()}>
                  <Plus size={15} />
                </button>
              </div>
              <div className="bd-col-body">
                {overCol === c.status && overIdx === 0 && (
                  <div className="bd-drop-indicator" />
                )}
                {c.items.map((t, i) => (
                  <React.Fragment key={`wrap-${t.id}`}>
                    <article
                    key={t.id}
                    className={'bd-card' + (dragId === t.id ? ' is-dragging' : '')}
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                    draggable
                    onDragStart={(e) => {
                      setDragId(t.id)
                      const el = e.currentTarget as HTMLElement
                      const rect = el.getBoundingClientRect()
                      const ghost = el.cloneNode(true) as HTMLElement
                      ghost.style.position = 'absolute'
                      ghost.style.top = '-9999px'
                      ghost.style.width = `${rect.width}px`
                      ghost.style.opacity = '0.85'
                      ghost.style.transform = 'rotate(2deg)'
                      document.body.appendChild(ghost)
                      e.dataTransfer.setDragImage(ghost, rect.width / 2, 20)
                      requestAnimationFrame(() => ghost.remove())
                    }}
                    onDragEnd={() => { setDragId(null); setOverCol(null); setOverIdx(null) }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      const rect = e.currentTarget.getBoundingClientRect()
                      const mid = rect.top + rect.height / 2
                      setOverIdx(e.clientY < mid ? i : i + 1)
                    }}
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
                          createReviewCase: (source) => {
                            const reviewCase = buildReviewCaseFromTrade(source, {
                              id: crypto.randomUUID(),
                              ref: getNextReviewCaseRef(trades),
                            })
                            upsertTrade(reviewCase)
                            toast('已沉淀为案例记录')
                            onOpen(reviewCase.id)
                          },
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
                  {overCol === c.status && overIdx === i + 1 && (
                    <div className="bd-drop-indicator" key={`ind-${i}`} />
                  )}
                </React.Fragment>
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

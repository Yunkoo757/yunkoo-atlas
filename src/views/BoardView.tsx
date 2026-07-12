import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus, Bell } from '@/icons/appIcons'
import { Topbar } from '@/components/Topbar'
import type { WorkbenchView } from '@/components/Topbar'
import { EmptyState } from '@/components/EmptyState'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { TradeFilters } from '@/components/trades/TradeFilters'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import { StrategyLabel } from '@/components/StrategyIcon'
import { useStore } from '@/store/useStore'
import {
  REVIEW_CATEGORY_META,
  STATUS_META,
  getTimeframeTone,
  resolveTimeframe,
  type TradeStatus,
  type Trade,
} from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { fmtMoney, fmtR } from '@/lib/format'
import { toast } from '@/lib/toast'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import { getTradesPageSubtitle } from '@/lib/pageCopy'
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
import { useListContextSync } from '@/shortcuts/useListContextSync'
import { useWorkbenchVisibleTrades } from '@/hooks/useWorkbenchVisibleTrades'
import { useTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { registerTradeScrollTarget } from '@/lib/tradeScrollTargets'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Strategy } from '@/data/strategies'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import './BoardView.css'

const CARD_ESTIMATE = 118
const CARD_GAP = 6

export function BoardView({
  title = '交易',
  view,
  onView,
  onOpen,
  filter = { type: 'all' },
  header,
}: {
  title?: string
  view: WorkbenchView
  onView: (v: WorkbenchView) => void
  onOpen: (id: string) => void
  filter?: ListFilter
  header?: ReactNode
}) {
  const strategies = useStore((s) => s.strategies)
  const symbolIcons = useStore((s) => s.symbolIcons)
  const display = useStore((s) => s.display)
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
  const [ctx, setCtx] = useState<CtxState | null>(null)

  useListContextSync(filter)
  useTradeReturnAnchor()
  const { trades, visible } = useWorkbenchVisibleTrades(filter)

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
    setOverIdx(null)
  }

  return (
    <>
      <Topbar title={title} subtitle={subtitle} view={view} onView={onView} />
      {header}
      <TradeFilters filter={filter} trades={trades} strategies={strategies} />
      <div className={'board-scroll' + (isReviewCaseView ? ' board-scroll-case' : '')}>
        {cols.length === 0 ? (
          <EmptyState
            title={isReviewCaseView ? '没有案例记录' : '没有交易'}
            hint={emptyHint}
            action={
              <button className="empty-btn" onClick={() => openComposer()}>
                <Plus size={15} />
                <span>新建{recordLabel}</span>
              </button>
            }
          />
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
                <span className="bd-col-add-wrap">
                  <Tooltip content={`新建${recordLabel}`} label={`新建${recordLabel}`}>
                    <button
                      className="bd-col-add"
                      aria-label={`新建${recordLabel}`}
                      onClick={() => openComposer()}
                    >
                      <Plus size={15} />
                    </button>
                  </Tooltip>
                </span>
              </div>
              <BoardColumnBody
                status={c.status}
                items={c.items}
                isReviewCaseView={isReviewCaseView}
                strategies={strategies}
                symbolIcons={symbolIcons}
                subscribedIds={subscribedIds}
                dragId={dragId}
                overCol={overCol}
                overIdx={overIdx}
                setDragId={setDragId}
                setOverCol={setOverCol}
                setOverIdx={setOverIdx}
                onOpen={onOpen}
                onContextMenu={(e, trade) => {
                  e.preventDefault()
                  setCtx({
                    x: e.clientX,
                    y: e.clientY,
                    items: buildTradeCtxItems(trade, {
                      setStatus,
                      changeStatus: (s) => transitionTradeStatus(trade, s, transition),
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
              />
            </div>
          ))
        )}
      </div>
      <ContextMenu state={ctx} onClose={() => setCtx(null)} />
    </>
  )
}

function BoardColumnBody({
  status,
  items,
  isReviewCaseView,
  strategies,
  symbolIcons,
  subscribedIds,
  dragId,
  overCol,
  overIdx,
  setDragId,
  setOverCol,
  setOverIdx,
  onOpen,
  onContextMenu,
}: {
  status: TradeStatus
  items: Trade[]
  isReviewCaseView: boolean
  strategies: Strategy[]
  symbolIcons: SymbolIconsMap
  subscribedIds: string[]
  dragId: string | null
  overCol: TradeStatus | null
  overIdx: number | null
  setDragId: (id: string | null) => void
  setOverCol: (status: TradeStatus | null) => void
  setOverIdx: (idx: number | null) => void
  onOpen: (id: string) => void
  onContextMenu: (event: React.MouseEvent, trade: Trade) => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => CARD_ESTIMATE,
    gap: CARD_GAP,
    overscan: 8,
  })

  useEffect(() => {
    return registerTradeScrollTarget((tradeId) => {
      const index = items.findIndex((trade) => trade.id === tradeId)
      if (index < 0) return false
      virtualizer.scrollToIndex(index, { align: 'center' })
      return true
    })
  }, [items, virtualizer])

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="bd-col-body bd-col-body-virtual" ref={bodyRef}>
      {overCol === status && overIdx === 0 && items.length === 0 && (
        <div className="bd-drop-indicator" />
      )}
      <div
        className="bd-col-virtual-inner"
        style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
      >
        {virtualItems.map((virtualRow) => {
          const t = items[virtualRow.index]!
          const i = virtualRow.index
          return (
            <div
              key={t.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="bd-card-virtual-slot"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {overCol === status && overIdx === i && <div className="bd-drop-indicator" />}
              <article
                data-trade-id={t.id}
                className={
                  'bd-card' +
                  (isReviewCaseView ? ' bd-card-case' : '') +
                  (dragId === t.id ? ' is-dragging' : '')
                }
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
                onDragEnd={() => {
                  setDragId(null)
                  setOverCol(null)
                  setOverIdx(null)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const mid = rect.top + rect.height / 2
                  setOverIdx(e.clientY < mid ? i : i + 1)
                }}
                onClick={() => onOpen(t.id)}
                onContextMenu={(e) => onContextMenu(e, t)}
              >
                <div className="bd-card-top">
                  <span className="bd-card-ref">{t.ref}</span>
                  {subscribedIds.includes(t.id) && (
                    <Bell size={12} className="bd-card-followed" aria-label="已置顶关注" />
                  )}
                  {isReviewCaseView ? (
                    <span className={'bd-category-badge bd-category-badge-' + t.reviewCategory}>
                      {REVIEW_CATEGORY_META[t.reviewCategory].label}
                    </span>
                  ) : (
                    <ConvictionIcon conviction={t.conviction} />
                  )}
                </div>
                <div className="bd-card-title">
                  <span className="bd-card-symbol">
                    <SymbolIcon symbol={t.symbol} overrides={symbolIcons} size={16} />
                    {t.symbol}
                  </span>
                  <SideTag side={t.side} />
                </div>
                <div className="bd-card-strategy">
                  <StrategyLabel strategyId={t.strategyId} strategies={strategies} />
                </div>
                <div className="bd-case-tags">
                  <span
                    className={`bd-case-tag bd-card-timeframe is-${getTimeframeTone(resolveTimeframe(t.timeframe))}`}
                    title={`波段级别 ${resolveTimeframe(t.timeframe)}`}
                  >
                    {resolveTimeframe(t.timeframe)}
                  </span>
                  {isReviewCaseView &&
                    t.mistakeTags.slice(0, 2).map((tag) => (
                      <span className="bd-case-tag bd-case-tag-danger" key={tag}>
                        {tag}
                      </span>
                    ))}
                  {isReviewCaseView &&
                    t.tags
                      .slice(0, t.mistakeTags.length > 0 ? 1 : 2)
                      .map((tag) => (
                        <span className="bd-case-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
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
                    {t.status === 'planned' || t.status === 'open' ? '—' : fmtMoney(t.pnl)}
                  </span>
                  {t.status !== 'planned' && t.status !== 'open' && (
                    <span className="bd-card-r">{fmtR(t.rMultiple)}</span>
                  )}
                </div>
              </article>
              {overCol === status && overIdx === i + 1 && <div className="bd-drop-indicator" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

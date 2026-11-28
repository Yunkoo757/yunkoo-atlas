import { TradeBatchActions } from '@/components/trades/TradeBatchActions'
import { intersectSelectedTradeIds } from '@/lib/tradeView'
import { BoardCardTags } from '@/components/trades/BoardCardTags'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLocation, useNavigate } from 'react-router-dom'
import { createRecordForContext, resolveCreateRecordAction } from '@/lib/createRecordAction'
import { Plus } from '@/icons/appIcons'
import type { WorkbenchView } from '@/components/Topbar'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { TradeWorkbenchHeader } from '@/components/trades/TradeWorkbenchHeader'
import { WorkbenchEmptyState } from '@/components/trades/WorkbenchEmptyState'
import { moveRecordsToTrash } from '@/lib/tradeTrashAction'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import { StrategyLabel } from '@/components/StrategyIcon'
import { useStore } from '@/store/useStore'
import {
  REVIEW_CATEGORY_META,
  CASE_TYPE_META,
  CONVICTION_META,
  STATUS_META,
  resolveTimeframe,
  type TradeStatus,
  type Trade,
} from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { resolveTradeRowResultPresentation, tradeMetricTone } from '@/lib/tradeRowPresentation'
import { toast } from '@/lib/toast'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import { useListContextSync } from '@/shortcuts/useListContextSync'
import { useWorkbenchListKeyboard, useWorkbenchRowFocus } from '@/hooks/useWorkbenchListKeyboard'
import { useWorkbenchVisibleTrades } from '@/hooks/useWorkbenchVisibleTrades'
import { registerTradeScrollTarget } from '@/lib/tradeScrollTargets'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Strategy } from '@/data/strategies'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import { useWorkbenchEmptyState } from '@/hooks/useWorkbenchEmptyState'
import './BoardView.css'
import './ListView.css'

const CARD_ESTIMATE = 118
const CARD_GAP = 6

export function BoardView({
  title = '交易',
  view,
  onView,
  onOpen,
  filter = { type: 'all' },
  header,
  journal = false,
}: {
  title?: string
  view: WorkbenchView
  onView: (v: WorkbenchView) => void
  onOpen: (id: string, focusField?: 'result', anchorId?: string) => void
  filter?: ListFilter
  header?: ReactNode
  journal?: boolean
}) {
  const strategies = useStore((s) => s.strategies)
  const symbolIcons = useStore((s) => s.symbolIcons)
  const display = useStore((s) => s.display)
  const requestTradeClose = useStore((s) => s.requestTradeClose)
  const requestTradeOpen = useStore((s) => s.requestTradeOpen)
  const setStatus = useStore((s) => s.setStatus)
  const openComposer = useStore((s) => s.openComposer)
  const toggleStar = useStore((s) => s.toggleStar)
  const isStarred = useStore((s) => s.isStarred)
  const toggleCaseFocus = useStore((s) => s.toggleCaseFocus)
  const isCaseFocused = useStore((s) => s.isCaseFocused)
  const legacyCashCurrencyAssumption = useStore((s) => s.profile.legacyCashCurrencyAssumption)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<TradeStatus | null>(null)
  const [ctx, setCtx] = useState<CtxState | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const navigate = useNavigate()
  const location = useLocation()
  const createRecord = () => createRecordForContext(location.pathname, location.search, navigate)
  const workspace = useWorkbenchVisibleTrades(filter)
  const { trades, visible } = workspace

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
  const orderedItems = useMemo(() => cols.flatMap((column) => column.items), [cols])
  useListContextSync(filter, orderedItems)
  const orderedIdsKey = useMemo(
    () => orderedItems.map((item) => item.id).join('\u0000'),
    [orderedItems],
  )
  const { focusedId, focusIndex, setFocusIndex } = useWorkbenchRowFocus(orderedItems)

  useWorkbenchListKeyboard({
    items: orderedItems,
    selectedIds,
    setSelectedIds,
    focusIndex,
    setFocusIndex,
    onOpenFocused: (index) => onOpen(orderedItems[index].id),
    enableNav: true,
  })

  useEffect(() => {
    setSelectedIds(current => {
      if (!current.size) return current
      const next = intersectSelectedTradeIds(current, orderedItems)
      return next.size === current.size ? current : next
    })
  }, [orderedIdsKey])

  const toggleSelection = (id: string) => setSelectedIds(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const isReviewCaseView = filter.tradeKind === 'case'
  const createLabel = resolveCreateRecordAction(location.pathname, location.search).label
  const { emptyState, resetEmptyConditions } = useWorkbenchEmptyState(filter, workspace, journal)

  const transition = { requestTradeClose, requestTradeOpen, setStatus, toast }

  const onDropToColumn = (status: TradeStatus) => {
    if (!dragId) return
    const trade = trades.find((t) => t.id === dragId)
    if (trade) transitionTradeStatus(trade, status, transition)
    setDragId(null)
    setOverCol(null)
  }

  return (
    <>
      <TradeWorkbenchHeader
        journal={journal}
        title={title}
        view={view}
        onView={onView}
        header={header}
        filter={filter}
        trades={trades}
        strategies={strategies}
        onOpenResult={id => onOpen(id, 'result')}
      />
      <div className="board-scroll">
        {emptyState ? (
          <WorkbenchEmptyState
            state={emptyState}
            onCreate={createRecord}
            onReset={resetEmptyConditions}
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
              onDragLeave={event => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
                setOverCol(current => current === c.status ? null : current)
              }}
              onDrop={() => onDropToColumn(c.status)}
            >
              <div className="bd-col-header">
                <StatusIcon status={c.status} size={ICON_MD} />
                <span className="bd-col-title">{STATUS_META[c.status].label}</span>
                <span className="bd-col-count">{c.items.length}</span>
                {(c.status === 'planned' || c.status === 'missed') && <span className="bd-col-add-wrap">
                  <Tooltip content={createLabel} label={createLabel}>
                    <button
                      className="bd-col-add"
                      aria-label={createLabel}
                      onClick={() => createRecordForContext(location.pathname, location.search, navigate, { status: c.status === 'missed' ? 'missed' : 'planned' })}
                    >
                      <Plus size={ICON_MD} />
                    </button>
                  </Tooltip>
                </span>}
              </div>
              <BoardColumnBody
                status={c.status}
                items={c.items}
                isReviewCaseView={isReviewCaseView}
                strategies={strategies}
                symbolIcons={symbolIcons}
                privacyMode={display.privacyMode}
                legacyCashCurrencyAssumption={legacyCashCurrencyAssumption}
                dragId={dragId}
                overCol={overCol}
                focusedId={focusedId}
                selectedIds={selectedIds}
                onToggleSelection={toggleSelection}
                setDragId={setDragId}
                setOverCol={setOverCol}
                onOpen={onOpen}
                onContextMenu={(trade, originElement, x, y) => {
                  setCtx({
                    x,
                    y,
                    originElement,
                    items: [
                      { type: 'item', label: selectedIds.has(trade.id) ? '取消选择' : '选择这条记录', onClick: () => toggleSelection(trade.id) },
                      { type: 'divider' },
                      ...buildTradeCtxItems(trade, {
                        setStatus,
                        requestTradeOpen,
                        changeStatus: (s) => transitionTradeStatus(trade, s, transition),
                        openComposer,
                        removeTrade: moveRecordsToTrash,
                        createReviewCase: (source) => {
                          const result = useStore.getState().createReviewCaseFromTrade(source.id)
                          if (result.status !== 'created') {
                            toast(result.status === 'source-is-case' ? '案例不能再次提炼' : '原交易已不存在', { tone: 'warning' })
                            return
                          }
                          toast('已提炼为案例', { tone: 'success' })
                          onOpen(result.reviewCase.id, undefined, source.id)
                        },
                        toggleStar,
                        isStarred,
                        toggleCaseFocus,
                        isCaseFocused,
                      }),
                    ],
                  })
                }}
              />
            </div>
          ))
        )}
      </div>
      <TradeBatchActions selectedIds={selectedIds} trades={trades} visible={visible} onClear={() => setSelectedIds(new Set())} />
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
  privacyMode,
  legacyCashCurrencyAssumption,
  dragId,
  overCol,
  focusedId,
  selectedIds,
  onToggleSelection,
  setDragId,
  setOverCol,
  onOpen,
  onContextMenu,
}: {
  status: TradeStatus
  items: Trade[]
  isReviewCaseView: boolean
  strategies: Strategy[]
  symbolIcons: SymbolIconsMap
  privacyMode: boolean
  legacyCashCurrencyAssumption: import('@/storage/types').LegacyCashCurrencyAssumption | null
  dragId: string | null
  overCol: TradeStatus | null
  focusedId: string | null
  selectedIds: Set<string>
  onToggleSelection: (id: string) => void
  setDragId: (id: string | null) => void
  setOverCol: (status: TradeStatus | null) => void
  onOpen: (id: string) => void
  onContextMenu: (trade: Trade, originElement: HTMLElement, x: number, y: number) => void
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

  useEffect(() => {
    if (!focusedId) return
    const index = items.findIndex(trade => trade.id === focusedId)
    if (index < 0) return
    virtualizer.scrollToIndex(index, { align: 'auto' })
    const frame = requestAnimationFrame(() => {
      const card = bodyRef.current?.querySelector<HTMLElement>(`[data-trade-id="${CSS.escape(focusedId)}"]`)
      card?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      card?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
    // 数据刷新不代表新的键盘定位意图，保留用户后来移到的控件焦点。
  }, [focusedId, virtualizer])

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="bd-col-body bd-col-body-virtual" ref={bodyRef}>
      <div
        className="bd-col-virtual-inner"
        style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
      >
        {virtualItems.map((virtualRow) => {
          const t = items[virtualRow.index]!
          const result = resolveTradeRowResultPresentation(
            t,
            legacyCashCurrencyAssumption,
            privacyMode,
          )
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
              <article
                data-trade-id={t.id}
                className={
                  'bd-card'
                  + (dragId === t.id ? ' is-dragging' : '')
                  + (focusedId === t.id ? ' is-focused' : '')
                  + (selectedIds.has(t.id) ? ' is-selected' : '')
                }
                draggable={selectedIds.size === 0}
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
                }}
                onClick={event => {
                  if (event.metaKey || event.ctrlKey) onToggleSelection(t.id)
                  else onOpen(t.id)
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault()
                    const card = event.currentTarget
                    const rect = card.getBoundingClientRect()
                    onContextMenu(t, card, rect.left, rect.bottom)
                    return
                  }
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onOpen(t.id)
                }}
                aria-description={selectedIds.has(t.id) ? '已选择' : undefined}
                onContextMenu={event => {
                  event.preventDefault()
                  onContextMenu(t, event.currentTarget, event.clientX, event.clientY)
                }}
                role="button"
                tabIndex={0}
              >
                <div className="bd-card-top">
                  <span className="bd-card-ref">{t.ref}</span>
                  {isReviewCaseView ? (
                    <span className={'bd-category-badge bd-category-badge-' + t.reviewCategory}>
                      {t.caseType
                        ? CASE_TYPE_META[t.caseType].label
                        : REVIEW_CATEGORY_META[t.reviewCategory].label}
                    </span>
                  ) : (
                    <ConvictionIcon conviction={t.conviction} label={`信心度：${CONVICTION_META[t.conviction].label}`} />
                  )}
                </div>
                <div className="bd-card-title">
                  <span className="bd-card-symbol">
                    <SymbolIcon symbol={t.symbol} overrides={symbolIcons} size={ICON_MD} quiet />
                    {t.symbol}
                  </span>
                  <SideTag side={t.side} quiet />
                  {result.r.state !== 'not-applicable' ? (
                    <span
                      className="bd-card-result"
                      data-value-state={result.r.state}
                      data-value-sign={result.r.state === 'value' ? tradeMetricTone(t.status, t.rMultiple) : undefined}
                      title={result.integrity === 'conflict' ? result.accessibleSummary : undefined}
                    >
                      {result.integrity === 'conflict' && <span className="bd-card-conflict">冲突</span>}
                      {result.r.text}
                    </span>
                  ) : null}
                </div>
                <div className="bd-card-strategy">
                  <StrategyLabel strategyId={t.strategyId} strategies={strategies} size={ICON_SM} variant="nav" />
                </div>
                <div className="bd-case-tags">
                  <span className="bd-case-tag bd-card-timeframe">
                    {resolveTimeframe(t.timeframe)}
                  </span>
                  {isReviewCaseView && <BoardCardTags errors={t.mistakeTags} tags={t.tags} />}
                </div>
              </article>
            </div>
          )
        })}
      </div>
    </div>
  )
}

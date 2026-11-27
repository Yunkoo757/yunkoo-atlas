import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import type { WorkbenchView } from '@/components/Topbar'
import { TradeWorkbenchHeader } from '@/components/trades/TradeWorkbenchHeader'
import { TradeList, type TradeListGroup } from '@/components/trades/TradeList'
import { WorkbenchEmptyState } from '@/components/trades/WorkbenchEmptyState'
import type { Trade } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { getStrategyName } from '@/lib/strategies'
import { createRecordForContext } from '@/lib/createRecordAction'
import { toast } from '@/lib/toast'
import { moveRecordsToTrash } from '@/lib/tradeTrashAction'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { tradeDetailPath, tradeDetailNavState, workbenchDetailFrom } from '@/lib/tradeRoute'
import {
  groupTradesByMonth,
  intersectSelectedTradeIds,
} from '@/lib/tradeView'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { useWorkbenchEmptyState } from '@/hooks/useWorkbenchEmptyState'
import { useListContextSync } from '@/shortcuts/useListContextSync'
import { useWorkbenchVisibleTrades } from '@/hooks/useWorkbenchVisibleTrades'
import { rememberTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { resultRepairAnchor } from '@/hooks/useResultRepairReturn'
import { TradeBatchActions } from '@/components/trades/TradeBatchActions'
import { useWorkbenchListKeyboard, useWorkbenchRowFocus } from '@/hooks/useWorkbenchListKeyboard'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import './ListView.css'

const expandedGroups: ReadonlySet<string> = new Set()

export function ListView({
  title = '交易',
  view,
  onView,
  filter = { type: 'all' },
  header,
  journal = false,
}: {
  title?: string
  view: WorkbenchView
  onView: (view: WorkbenchView) => void
  filter?: ListFilter
  header?: ReactNode
  journal?: boolean
}) {
  const strategies = useStore((state) => state.strategies)
  const display = useStore((state) => state.display)
  const starredIds = useStore((state) => state.starredIds)
  const openComposer = useStore((state) => state.openComposer)
  const setStatus = useStore((state) => state.setStatus)
  const requestTradeClose = useStore((state) => state.requestTradeClose)
  const requestTradeOpen = useStore((state) => state.requestTradeOpen)
  const toggleStar = useStore((state) => state.toggleStar)
  const isStarred = useStore((state) => state.isStarred)
  const toggleCaseFocus = useStore((state) => state.toggleCaseFocus)
  const isCaseFocused = useStore((state) => state.isCaseFocused)
  const [contextMenu, setContextMenu] = useState<CtxState | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const listScrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname
  const [disclosure, setDisclosure] = useState(() => {
    const last = useShortcutStore.getState().listContext
    const restored = last?.listPath === pathname && last.listSearch === location.search
      ? last.collapsedGroups : undefined
    return { pathname, groups: restored ?? expandedGroups }
  })
  const collapsedGroups = disclosure.pathname === pathname ? disclosure.groups : expandedGroups
  const changeCollapsedGroups = useCallback((groups: ReadonlySet<string>) => {
    setDisclosure({ pathname, groups })
  }, [pathname])
  const createRecord = () => createRecordForContext(location.pathname, location.search, navigate)
  const workspace = useWorkbenchVisibleTrades(filter)
  const { trades, visible, stageScope } = workspace

  const openTrade = useCallback((trade: Trade, focusField?: 'result', anchorId = trade.id) => {
    const from = workbenchDetailFrom(location, focusField ? resultRepairAnchor(anchorId) : anchorId)
    rememberTradeReturnAnchor(from)
    navigate(tradeDetailPath(trade), {
      state: tradeDetailNavState(from, { focusField }),
    })
  }, [location, navigate])

  const groups = useMemo<TradeListGroup[]>(() => {
    if (filter.type === 'period' && filter.period === 'today') {
      return [{ key: 'today', items: visible }]
    }

    if (display.groupByStrategy) {
      const grouped = new Map<string, Trade[]>()
      for (const trade of visible) {
        const items = grouped.get(trade.strategyId) ?? []
        items.push(trade)
        grouped.set(trade.strategyId, items)
      }
      return [...grouped.entries()]
        .map(([strategyId, items]) => ({
          key: `strategy-${strategyId}`,
          label: getStrategyName(strategies, strategyId),
          strategyId,
          items,
        }))
        .sort((left, right) => left.label!.localeCompare(right.label!, 'zh-CN'))
    }

    if (display.groupByDate) {
      return groupTradesByMonth(visible, new Date(), display.sortDirection)
    }

    return [{ key: 'all-records', items: visible }]
  }, [visible, filter.type, filter.period, filter.tradeKind, display.groupByStrategy, display.groupByDate, display.sortDirection, strategies])

  const orderedItems = useMemo(
    () => groups.flatMap((group) => collapsedGroups.has(group.key) ? [] : group.items),
    [groups, collapsedGroups],
  )
  useListContextSync(filter, orderedItems, collapsedGroups)
  const orderedIdsKey = useMemo(
    () => orderedItems.map((trade) => trade.id).join('\u0000'),
    [orderedItems],
  )

  const { focusedId, focusIndex, setFocusIndex } = useWorkbenchRowFocus(orderedItems)

  useWorkbenchListKeyboard({
    items: orderedItems,
    selectedIds,
    setSelectedIds,
    focusIndex,
    setFocusIndex,
    onOpenFocused: (index) => openTrade(orderedItems[index]),
    enableNav: true,
  })

  useEffect(() => {
    setSelectedIds((current) => {
      if (!current.size) return current
      const next = intersectSelectedTradeIds(current, orderedItems)
      if (next.size === current.size) return current
      return next
    })
  }, [orderedIdsKey])

  const toggleSelection = useCallback((trade: Trade) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(trade.id)) next.delete(trade.id)
      else next.add(trade.id)
      return next
    })
  }, [])

  const toggleRowStar = useCallback((trade: Trade) => {
    if (trade.tradeKind === 'case') toggleCaseFocus(trade.id)
    else toggleStar(trade.id)
  }, [toggleCaseFocus, toggleStar])

  const openContextMenu = useCallback((event: React.MouseEvent, trade: Trade) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      originElement: event.currentTarget as HTMLElement,
      items: buildTradeCtxItems(trade, {
        setStatus,
        requestTradeOpen,
        changeStatus: (status) =>
          transitionTradeStatus(trade, status, { requestTradeClose, requestTradeOpen, setStatus, toast }),
        openComposer,
        removeTrade: moveRecordsToTrash,
        createReviewCase: (source) => {
          const result = useStore.getState().createReviewCaseFromTrade(source.id)
          if (result.status !== 'created') {
            toast(result.status === 'source-is-case' ? '案例不能再次提炼' : '原交易已不存在', { tone: 'warning' })
            return
          }
          toast('已提炼为案例', { tone: 'success' })
          openTrade(result.reviewCase, undefined, source.id)
        },
        toggleStar,
        isStarred,
        toggleCaseFocus,
        isCaseFocused,
      }),
    })
  }, [
    isStarred,
    isCaseFocused,
    openComposer,
    openTrade,
    requestTradeClose,
    requestTradeOpen,
    setStatus,
    toggleStar,
    toggleCaseFocus,
    trades,
  ])

  const { emptyState, resetEmptyConditions } = useWorkbenchEmptyState(filter, workspace, journal)

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
        onOpenResult={(id) => {
          const trade = trades.find(item => item.id === id)
          if (trade) openTrade(trade, 'result')
        }}
      />
      <div className="list-scroll" ref={listScrollRef}>
        {emptyState ? (
          <WorkbenchEmptyState
            state={emptyState}
            onCreate={createRecord}
            onReset={resetEmptyConditions}
          />
        ) : (
          <TradeList
            groups={groups}
            disclosure={{ collapsed: collapsedGroups, onChange: changeCollapsedGroups }}
            strategies={strategies}
            focusedId={focusedId}
            selectedIds={selectedIds}
            starredIds={filter.tradeKind === 'case'
              ? trades.filter((trade) => trade.tradeKind === 'case' && trade.isFocusCase).map((trade) => trade.id)
              : starredIds}
            scrollParentRef={listScrollRef}
            onOpen={openTrade}
            onSelect={toggleSelection}
            onClearSelection={() => setSelectedIds(new Set())}
            onToggleStar={toggleRowStar}
            onContextMenu={openContextMenu}
            onCreate={group => createRecordForContext(location.pathname, location.search, navigate, group)}
            recordLabel={filter.tradeKind === 'case' ? '案例' : filter.tradeKind === 'paper' ? '模拟交易' : '交易'}
            mistakesFirst={filter.reviewCaseScope === 'mistakes'}
            strategyStageScope={stageScope}
          />
        )}
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      <TradeBatchActions selectedIds={selectedIds} trades={trades} visible={orderedItems} onClear={() => setSelectedIds(new Set())} />
    </>
  )
}

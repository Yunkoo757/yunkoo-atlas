import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Copy, Plus, Trash2 } from '@/icons/appIcons'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { EmptyState } from '@/components/EmptyState'
import { Topbar, type WorkbenchView } from '@/components/Topbar'
import { TradeFilters } from '@/components/trades/TradeFilters'
import { TradeList, type TradeListGroup } from '@/components/trades/TradeList'
import type { Trade } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { getTradesPageSubtitle } from '@/lib/pageCopy'
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
import { getStrategyName } from '@/lib/strategies'
import { toast } from '@/lib/toast'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { tradeDetailPath, tradeDetailNavState } from '@/lib/tradeRoute'
import {
  groupTradesByMonth,
  intersectSelectedTradeIds,
  sortReviewCasesByRecentActivity,
  sortTradesByOpenedAtDesc,
} from '@/lib/tradeView'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { useListContextSync } from '@/shortcuts/useListContextSync'
import { useWorkbenchVisibleTrades } from '@/hooks/useWorkbenchVisibleTrades'
import { rememberTradeReturnAnchor, useTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { BatchActionBar } from '@/components/ui/BatchActionBar'
import { useWorkbenchListKeyboard } from '@/hooks/useWorkbenchListKeyboard'
import { useStore } from '@/store/useStore'
import './ListView.css'

export function ListView({
  title = '交易',
  view,
  onView,
  filter = { type: 'all' },
  header,
}: {
  title?: string
  view: WorkbenchView
  onView: (view: WorkbenchView) => void
  filter?: ListFilter
  header?: ReactNode
}) {
  const trades = useStore((state) => state.trades).filter((trade) => !trade.deletedAt)
  const strategies = useStore((state) => state.strategies)
  const display = useStore((state) => state.display)
  const starredIds = useStore((state) => state.starredIds)
  const subscribedIds = useStore((state) => state.subscribedIds)
  const openComposer = useStore((state) => state.openComposer)
  const setStatus = useStore((state) => state.setStatus)
  const updateTradeData = useStore((state) => state.updateTradeData)
  const removeTrade = useStore((state) => state.removeTrade)
  const upsertTrade = useStore((state) => state.upsertTrade)
  const toggleStar = useStore((state) => state.toggleStar)
  const isStarred = useStore((state) => state.isStarred)
  const [contextMenu, setContextMenu] = useState<CtxState | null>(null)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const navigate = useNavigate()
  const location = useLocation()

  useListContextSync(filter)
  useTradeReturnAnchor()
  const { visible } = useWorkbenchVisibleTrades(filter)

  const openTrade = (trade: Trade) => {
    const from = {
      pathname: location.pathname,
      search: location.search,
      anchorTradeId: trade.id,
    }
    rememberTradeReturnAnchor(from)
    navigate(tradeDetailPath(trade), {
      state: tradeDetailNavState(from),
    })
  }

  const groups = useMemo<TradeListGroup[]>(() => {
    if (filter.tradeKind === 'case') {
      return [{ key: 'review-cases', items: sortReviewCasesByRecentActivity(visible) }]
    }

    if (filter.type === 'period' && filter.period === 'today') {
      return [
        {
          key: 'today',
          items: sortTradesByOpenedAtDesc(visible),
        },
      ]
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
          items,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    }

    if (display.groupByDate) {
      return groupTradesByMonth(visible)
    }

    return [{ key: 'all', items: sortTradesByOpenedAtDesc(visible) }]
  }, [visible, filter.type, filter.period, filter.tradeKind, display.groupByStrategy, display.groupByDate, strategies])

  const focusedId =
    focusIndex >= 0 && focusIndex < visible.length ? visible[focusIndex].id : null
  const visibleIdsKey = visible.map((trade) => trade.id).join('\u0000')

  useWorkbenchListKeyboard({
    items: visible,
    selectedIds,
    setSelectedIds,
    focusIndex,
    setFocusIndex,
    onOpenFocused: (index) => openTrade(visible[index]),
    enableNav: true,
  })

  useEffect(() => setFocusIndex(-1), [visible.length])

  useEffect(() => {
    setSelectedIds((current) => {
      const next = intersectSelectedTradeIds(current, visible)
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current
      return next
    })
  }, [visibleIdsKey])

  const toggleSelection = (trade: Trade) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(trade.id)) next.delete(trade.id)
      else next.add(trade.id)
      return next
    })
  }

  const batchDelete = () => {
    const actionableIds = intersectSelectedTradeIds(selectedIds, visible)
    actionableIds.forEach((id) => removeTrade(id))
    toast(`已将 ${actionableIds.size} 笔交易移至回收站，30天后自动清空`)
    setSelectedIds(new Set())
  }

  const batchCopy = () => {
    let copied = 0
    const actionableIds = intersectSelectedTradeIds(selectedIds, visible)
    actionableIds.forEach((id) => {
      const source = trades.find((trade) => trade.id === id)
      if (!source) return
      upsertTrade({
        ...source,
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ref: `TRD-${Date.now().toString(36).toUpperCase()}`,
      })
      copied += 1
    })
    toast(`已复制 ${copied} 笔交易`)
    setSelectedIds(new Set())
  }

  const openContextMenu = (event: React.MouseEvent, trade: Trade) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildTradeCtxItems(trade, {
        setStatus,
        changeStatus: (status) =>
          transitionTradeStatus(trade, status, { updateTradeData, setStatus, toast }),
        openComposer,
        removeTrade,
        createReviewCase: (source) => {
          const reviewCase = buildReviewCaseFromTrade(source, {
            id: crypto.randomUUID(),
            ref: getNextReviewCaseRef(trades),
          })
          upsertTrade(reviewCase)
          toast('已沉淀为案例记录')
          openTrade(reviewCase)
        },
        toggleStar,
        isStarred,
      }),
    })
  }

  const isReviewCaseView = filter.tradeKind === 'case'
  const isPaperView = filter.tradeKind === 'paper'
  const recordLabel = isReviewCaseView ? '案例记录' : isPaperView ? '模拟交易' : '交易'
  const emptyHint =
    isReviewCaseView
      ? '记录典型案例，沉淀可复用的交易模式。'
      : isPaperView
        ? '创建模拟交易，验证策略与执行流程。'
      : filter.type === 'active'
      ? '暂无进行中的交易。'
      : filter.type === 'starred'
        ? '还没有星标交易。'
        : filter.type === 'strategy'
          ? `「${getStrategyName(strategies, filter.strategyId)}」策略下暂无交易。`
          : filter.type === 'missed'
            ? '还没有记录错过的机会。'
            : filter.type === 'period'
              ? '该时间段内没有按开仓日匹配的交易。'
              : '记录第一笔交易，开始构建复盘日志。'

  return (
    <>
      <Topbar title={title} subtitle={getTradesPageSubtitle(filter)} view={view} onView={onView} />
      {header}
      <TradeFilters filter={filter} trades={trades} strategies={strategies} />
      <div className="list-scroll">
        {visible.length === 0 ? (
          <EmptyState
            title={isReviewCaseView ? '还没有案例记录' : isPaperView ? '还没有模拟交易' : '还没有交易'}
            hint={emptyHint}
            action={(
              <button className="empty-btn" onClick={() => openComposer()}>
                <Plus size={15} />
                <span>新建{recordLabel}</span>
              </button>
            )}
          />
        ) : (
          <TradeList
            groups={groups}
            strategies={strategies}
            focusedId={focusedId}
            selectedIds={selectedIds}
            starredIds={starredIds}
            followedIds={subscribedIds}
            onOpen={openTrade}
            onSelect={toggleSelection}
            onToggleStar={(trade) => toggleStar(trade.id)}
            onContextMenu={openContextMenu}
            onCreate={openComposer}
          />
        )}
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      <BatchActionBar count={selectedIds.size}>
        <button type="button" className="batch-action-btn" onClick={batchCopy}>
          <Copy size={14} />
          <span>复制</span>
        </button>
        <button type="button" className="batch-action-btn batch-action-btn-danger" onClick={batchDelete}>
          <Trash2 size={14} />
          <span>删除</span>
        </button>
      </BatchActionBar>
    </>
  )
}

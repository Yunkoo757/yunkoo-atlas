import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Copy, Trash2 } from '@/icons/appIcons'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { Topbar, type WorkbenchView } from '@/components/Topbar'
import { TradeFilters } from '@/components/trades/TradeFilters'
import { TradeList, type TradeListGroup } from '@/components/trades/TradeList'
import { WorkbenchEmptyState } from '@/components/trades/WorkbenchEmptyState'
import type { Trade } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { getTradesPageSubtitle } from '@/lib/pageCopy'
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
import { getStrategyName } from '@/lib/strategies'
import { buildSafeTradeCopies } from '@/lib/tradeCopy'
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
import {
  getWorkbenchResetPath,
  resolveWorkbenchEmptyState,
  shouldResetWorkbenchHideClosed,
} from '@/lib/workbenchEmptyState'
import { useListContextSync } from '@/shortcuts/useListContextSync'
import { useWorkbenchVisibleTrades } from '@/hooks/useWorkbenchVisibleTrades'
import { rememberTradeReturnAnchor, useTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { BatchActionBar } from '@/components/ui/BatchActionBar'
import { ModalShell } from '@/components/ui/ModalShell'
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
  const strategies = useStore((state) => state.strategies)
  const display = useStore((state) => state.display)
  const setDisplay = useStore((state) => state.setDisplay)
  const starredIds = useStore((state) => state.starredIds)
  const openComposer = useStore((state) => state.openComposer)
  const setStatus = useStore((state) => state.setStatus)
  const requestTradeClose = useStore((state) => state.requestTradeClose)
  const removeTrade = useStore((state) => state.removeTrade)
  const removeTrades = useStore((state) => state.removeTrades)
  const upsertTrade = useStore((state) => state.upsertTrade)
  const upsertTrades = useStore((state) => state.upsertTrades)
  const toggleStar = useStore((state) => state.toggleStar)
  const isStarred = useStore((state) => state.isStarred)
  const [contextMenu, setContextMenu] = useState<CtxState | null>(null)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [copyCandidateIds, setCopyCandidateIds] = useState<string[] | null>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  useListContextSync(filter)
  useTradeReturnAnchor()
  const { trades, visible, workspaceCount, businessDateAnchor } = useWorkbenchVisibleTrades(filter)

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
          strategyId,
          items,
        }))
        .sort((left, right) => left.label!.localeCompare(right.label!, 'zh-CN'))
    }

    if (display.groupByDate) {
      return groupTradesByMonth(visible)
    }

    const sorted = sortTradesByOpenedAtDesc(visible)
    const pending = sorted.filter((trade) => trade.reviewStatus !== 'reviewed')
    const completed = sorted.filter((trade) => trade.reviewStatus === 'reviewed')
    return [
      ...(pending.length > 0
        ? [{ key: 'pending-review', label: '待复盘', tone: 'pending' as const, items: pending }]
        : []),
      ...(completed.length > 0
        ? [{ key: 'completed-review', label: '已完成', tone: 'completed' as const, items: completed }]
        : []),
    ]
  }, [visible, filter.type, filter.period, filter.tradeKind, display.groupByStrategy, display.groupByDate, strategies])

  const focusedId =
    focusIndex >= 0 && focusIndex < visible.length ? visible[focusIndex].id : null
  const visibleIdsKey = useMemo(
    () => visible.map((trade) => trade.id).join('\u0000'),
    [visible],
  )

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
    const count = actionableIds.size
    const previousActionId = useStore.getState().undoStack.at(-1)?.actionId
    removeTrades([...actionableIds])
    const latestActionId = useStore.getState().undoStack.at(-1)?.actionId
    const actionId = latestActionId !== previousActionId ? latestActionId : undefined
    toast(`已将 ${count} 笔交易移至回收站，30 天后自动清空`, {
      label: '撤销',
      onClick: () => {
        if (actionId && useStore.getState().undo(actionId)) toast('已恢复删除的交易')
        else toast('目标交易之后已变化，无法安全撤销')
      },
    })
    setSelectedIds(new Set())
  }

  const requestBatchCopy = () => {
    const actionableIds = intersectSelectedTradeIds(selectedIds, visible)
    if (actionableIds.size === 0) {
      toast('当前没有可复制的记录')
      return
    }
    setCopyCandidateIds([...actionableIds])
  }

  const confirmBatchCopy = () => {
    if (!copyCandidateIds) return
    const sourceById = new Map(trades.map((trade) => [trade.id, trade]))
    const sources = copyCandidateIds
      .map((id) => sourceById.get(id))
      .filter((trade): trade is Trade => Boolean(trade && !trade.deletedAt))
    if (sources.length !== copyCandidateIds.length) {
      toast('部分源记录已变化，请重新选择后再复制')
      setCopyCandidateIds(null)
      return
    }

    try {
      const copies = buildSafeTradeCopies(sources, trades, {
        now: new Date(),
        createId: () => crypto.randomUUID(),
      })
      upsertTrades(copies)

      const hasCases = sources.some((trade) => trade.tradeKind === 'case')
      const hasAccountTrades = sources.some((trade) => trade.tradeKind !== 'case')
      toast(
        hasCases && hasAccountTrades
          ? `已安全复制 ${copies.length} 条记录`
          : hasCases
            ? `已复制 ${copies.length} 个案例`
            : `已将 ${copies.length} 笔交易复制为新计划`,
      )
      setSelectedIds(new Set())
      setCopyCandidateIds(null)
    } catch (error) {
      toast(error instanceof Error ? error.message : '安全复制失败，源记录未改变')
      setCopyCandidateIds(null)
    }
  }

  const selectedSources = visible.filter((trade) => selectedIds.has(trade.id))
  const selectionHasCases = selectedSources.some((trade) => trade.tradeKind === 'case')
  const selectionHasAccountTrades = selectedSources.some((trade) => trade.tradeKind !== 'case')
  const copyActionLabel = selectionHasCases && selectionHasAccountTrades
    ? '安全复制'
    : selectionHasCases
      ? '复制案例'
      : '复制为新计划'
  const copyCandidateSet = new Set(copyCandidateIds ?? [])
  const copyCandidates = trades.filter((trade) => copyCandidateSet.has(trade.id))
  const copyAccountCount = copyCandidates.filter((trade) => trade.tradeKind !== 'case').length
  const copyCaseCount = copyCandidates.length - copyAccountCount
  const copyConfirmLabel = copyAccountCount > 0 && copyCaseCount > 0
    ? `创建 ${copyCandidates.length} 条安全副本`
    : copyCaseCount > 0
      ? `复制 ${copyCaseCount} 个案例`
      : `创建 ${copyAccountCount} 笔新计划`

  const openContextMenu = (event: React.MouseEvent, trade: Trade) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildTradeCtxItems(trade, {
        setStatus,
        changeStatus: (status) =>
          transitionTradeStatus(trade, status, { requestTradeClose, setStatus, toast }),
        openComposer,
        removeTrade,
        createReviewCase: (source) => {
          const reviewCase = buildReviewCaseFromTrade(source, {
            id: crypto.randomUUID(),
            ref: getNextReviewCaseRef(trades),
          })
          upsertTrade(reviewCase)
          toast('已提炼为案例')
          openTrade(reviewCase)
        },
        toggleStar,
        isStarred,
      }),
    })
  }

  const emptyState = resolveWorkbenchEmptyState({
    totalCount: trades.length,
    workspaceCount,
    visibleCount: visible.length,
    recordKind: filter.tradeKind,
  })
  const resetEmptyConditions = () => {
    if (shouldResetWorkbenchHideClosed({
      hideClosed: display.hideClosed,
      trades,
      filter,
      starredIds,
      search: location.search,
      businessDateAnchor,
    })) {
      setDisplay({ hideClosed: false })
    }
    navigate(getWorkbenchResetPath(location.pathname, filter.tradeKind), { replace: true })
  }

  return (
    <>
      <Topbar title={title} subtitle={getTradesPageSubtitle(filter, businessDateAnchor)} view={view} onView={onView} />
      {header}
      {emptyState?.kind !== 'library' ? (
        <TradeFilters filter={filter} trades={trades} strategies={strategies} />
      ) : null}
      <div className="list-scroll" ref={listScrollRef}>
        {emptyState ? (
          <WorkbenchEmptyState
            state={emptyState}
            onCreate={() => openComposer()}
            onReset={resetEmptyConditions}
          />
        ) : (
          <TradeList
            groups={groups}
            strategies={strategies}
            focusedId={focusedId}
            selectedIds={selectedIds}
            starredIds={starredIds}
            scrollParentRef={listScrollRef}
            onOpen={openTrade}
            onSelect={toggleSelection}
            onToggleStar={(trade) => toggleStar(trade.id)}
            onContextMenu={openContextMenu}
            onCreate={openComposer}
            recordLabel={filter.tradeKind === 'case' ? '案例记录' : '交易'}
          />
        )}
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      <BatchActionBar count={selectedIds.size}>
        <button type="button" className="batch-action-btn" onClick={requestBatchCopy}>
          <Copy size={14} />
          <span>{copyActionLabel}</span>
        </button>
        <button type="button" className="batch-action-btn batch-action-btn-danger" onClick={batchDelete}>
          <Trash2 size={14} />
          <span>删除</span>
        </button>
      </BatchActionBar>
      {copyCandidateIds ? (
        <ModalShell
          title="确认安全复制"
          description={`将为已选 ${copyCandidates.length} 条记录创建独立副本；源记录不会改变。`}
          onClose={() => setCopyCandidateIds(null)}
          footer={(
            <>
              <button
                type="button"
                className="dio-btn"
                data-autofocus
                onClick={() => setCopyCandidateIds(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="dio-btn dio-btn-primary"
                disabled={copyCandidates.length !== copyCandidateIds.length}
                onClick={confirmBatchCopy}
              >
                {copyConfirmLabel}
              </button>
            </>
          )}
        >
          <div className="copy-preview">
            {copyAccountCount > 0 ? (
              <section className="copy-preview-section">
                <div className="copy-preview-heading">
                  <strong>{copyAccountCount} 笔实盘/模拟记录</strong>
                  <span>目标：新的计划</span>
                </div>
                <dl className="copy-preview-list">
                  <div>
                    <dt>保留</dt>
                    <dd>品种、方向、策略、周期、标签、止损、仓位与交易上下文</dd>
                  </div>
                  <div>
                    <dt>清空</dt>
                    <dd>成交与平仓结果、盈亏/R、复盘正文与状态、错误标签、评论、活动、删除及案例字段</dd>
                  </div>
                </dl>
              </section>
            ) : null}
            {copyCaseCount > 0 ? (
              <section className="copy-preview-section">
                <div className="copy-preview-heading">
                  <strong>{copyCaseCount} 个案例</strong>
                  <span>目标：新的知识案例</span>
                </div>
                <dl className="copy-preview-list">
                  <div>
                    <dt>保留</dt>
                    <dd>案例正文、分类、标签、错误标签与来源追溯</dd>
                  </div>
                  <div>
                    <dt>重置</dt>
                    <dd>掌握状态、复看进度、复盘完成时间、评论、活动与删除状态</dd>
                  </div>
                </dl>
              </section>
            ) : null}
          </div>
        </ModalShell>
      ) : null}
    </>
  )
}

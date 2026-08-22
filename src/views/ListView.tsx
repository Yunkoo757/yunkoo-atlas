import { ICON_SM } from '@/icons/iconSize'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Copy, Trash2 } from '@/icons/appIcons'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { Topbar, type WorkbenchView } from '@/components/Topbar'
import { TradeFilters } from '@/components/trades/TradeFilters'
import { TradeList, type TradeListGroup } from '@/components/trades/TradeList'
import { WorkbenchEmptyState } from '@/components/trades/WorkbenchEmptyState'
import { isReviewCompleted, type Trade } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { getTradesPageSubtitle } from '@/lib/pageCopy'
import { getStrategyName } from '@/lib/strategies'
import { getBatchCopyActionLabel } from '@/lib/tradeActionContract'
import { buildSafeTradeCopies } from '@/lib/tradeCopy'
import { toast } from '@/lib/toast'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { tradeDetailPath, tradeDetailNavState, type TradeDetailLocationState } from '@/lib/tradeRoute'
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
import { filterStageTrades } from '@/lib/stageArchive'
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
  const storedTrades = useStore((state) => state.trades)
  const display = useStore((state) => state.display)
  const setDisplay = useStore((state) => state.setDisplay)
  const starredIds = useStore((state) => state.starredIds)
  const openComposer = useStore((state) => state.openComposer)
  const setStatus = useStore((state) => state.setStatus)
  const requestTradeClose = useStore((state) => state.requestTradeClose)
  const requestTradeOpen = useStore((state) => state.requestTradeOpen)
  const removeTrade = useStore((state) => state.removeTrade)
  const removeTrades = useStore((state) => state.removeTrades)
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
  const pendingCount = useMemo(() => {
    if (filter.tradeKind !== 'live') return 0
    return filterStageTrades(storedTrades, { kind: 'pending' }).length
  }, [filter.tradeKind, storedTrades])
  const showPendingLink = filter.tradeKind === 'live'
    && pendingCount > 0

  useListContextSync(filter)
  useTradeReturnAnchor()
  const { trades, visible, totalCount, workspaceCount, businessDateAnchor } = useWorkbenchVisibleTrades(filter)

  const openTrade = useCallback((trade: Trade) => {
    const inheritedFrom = (location.state as TradeDetailLocationState | null)?.from
    const inheritedArchive = inheritedFrom?.pathname === '/live-history'
      || inheritedFrom?.pathname === '/live-archive'
      || inheritedFrom?.pathname.startsWith('/live-archive/')
    const from = {
      pathname: inheritedArchive ? inheritedFrom!.pathname : location.pathname,
      search: inheritedArchive ? inheritedFrom!.search ?? '' : location.search,
      anchorTradeId: trade.id,
    }
    rememberTradeReturnAnchor(from)
    navigate(tradeDetailPath(trade), {
      state: tradeDetailNavState(from),
    })
  }, [location.pathname, location.search, navigate])

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
    const pending = sorted.filter((trade) => !isReviewCompleted(trade.reviewStatus))
    const completed = sorted.filter((trade) => isReviewCompleted(trade.reviewStatus))
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

  const toggleSelection = useCallback((trade: Trade) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(trade.id)) next.delete(trade.id)
      else next.add(trade.id)
      return next
    })
  }, [])

  const toggleRowStar = useCallback((trade: Trade) => {
    toggleStar(trade.id)
  }, [toggleStar])

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
      if (upsertTrades(copies) !== 'updated') throw new Error('复制失败，请重试')

      const hasCases = sources.some((trade) => trade.tradeKind === 'case')
      const hasAccountTrades = sources.some((trade) => trade.tradeKind !== 'case')
      toast(
        hasCases && hasAccountTrades
          ? `已复制 ${copies.length} 条记录`
          : hasCases
            ? `已复制 ${copies.length} 个案例`
            : `已将 ${copies.length} 笔交易复制为新计划`,
      )
      setSelectedIds(new Set())
      setCopyCandidateIds(null)
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制失败，源记录未改变')
      setCopyCandidateIds(null)
    }
  }

  const selectedSources = visible.filter((trade) => selectedIds.has(trade.id))
  const copyActionLabel = getBatchCopyActionLabel(selectedSources)
  const copyCandidateSet = new Set(copyCandidateIds ?? [])
  const copyCandidates = trades.filter((trade) => copyCandidateSet.has(trade.id))
  const copyAccountCount = copyCandidates.filter((trade) => trade.tradeKind !== 'case').length
  const copyCaseCount = copyCandidates.length - copyAccountCount
  const copyConfirmLabel = copyAccountCount > 0 && copyCaseCount > 0
    ? `复制 ${copyCandidates.length} 条记录`
    : copyCaseCount > 0
      ? `复制 ${copyCaseCount} 个案例`
      : `创建 ${copyAccountCount} 笔新计划`

  const openContextMenu = useCallback((event: React.MouseEvent, trade: Trade) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildTradeCtxItems(trade, {
        setStatus,
        requestTradeOpen,
        changeStatus: (status) =>
          transitionTradeStatus(trade, status, { requestTradeClose, requestTradeOpen, setStatus, toast }),
        openComposer,
        removeTrade,
        createReviewCase: (source) => {
          const result = useStore.getState().createReviewCaseFromTrade(source.id)
          if (result.status !== 'created') {
            toast(result.status === 'source-is-case' ? '案例不能再次提炼' : '原交易已不存在')
            return
          }
          toast('已提炼为案例')
          openTrade(result.reviewCase)
        },
        toggleStar,
        isStarred,
      }),
    })
  }, [
    isStarred,
    openComposer,
    openTrade,
    removeTrade,
    requestTradeClose,
    requestTradeOpen,
    setStatus,
    toggleStar,
    trades,
  ])

  const emptyState = resolveWorkbenchEmptyState({
    totalCount,
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
    if (filter.historicalLiveScope) {
      const params = new URLSearchParams(location.search)
      for (const key of [...params.keys()]) {
        if (key !== 'liveStage' && key !== 'tab') params.delete(key)
      }
      navigate({
        pathname: '/live-history',
        search: params.toString(),
      }, { replace: true })
      return
    }
    navigate(getWorkbenchResetPath(location.pathname, filter.tradeKind), { replace: true })
  }

  return (
    <>
      <Topbar title={title} subtitle={getTradesPageSubtitle(filter, businessDateAnchor)} view={view} onView={onView} />
      {showPendingLink ? (
        <div className="list-pending-entry">
          <Link
            data-pending-log-link
            className="list-pending-link"
            to="/settings/data-health"
            aria-label={`修复待归属记录，共 ${pendingCount} 条`}
          >
            待归属 {pendingCount}
          </Link>
        </div>
      ) : null}
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
            onClearSelection={() => setSelectedIds(new Set())}
            onToggleStar={toggleRowStar}
            onContextMenu={openContextMenu}
            onCreate={openComposer}
            recordLabel={filter.tradeKind === 'case' ? '案例记录' : '交易'}
          />
        )}
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      <BatchActionBar count={selectedIds.size}>
        <button type="button" className="batch-bar-action-btn" onClick={requestBatchCopy}>
          <Copy size={ICON_SM} />
          <span>{copyActionLabel}</span>
        </button>
        <button type="button" className="batch-bar-action-btn batch-bar-action-btn-danger" onClick={batchDelete}>
          <Trash2 size={ICON_SM} />
          <span>删除</span>
        </button>
      </BatchActionBar>
      {copyCandidateIds ? (
        <ModalShell
          title="确认复制所选记录"
          description={`将为已选 ${copyCandidates.length} 条记录创建独立副本；源记录不会改变。`}
          size="compact"
          panelClassName="copy-confirm-modal"
          onClose={() => setCopyCandidateIds(null)}
          footer={(
            <>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus
                onClick={() => setCopyCandidateIds(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
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

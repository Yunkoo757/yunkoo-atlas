import { playMotion, reducesMotion } from '@/lib/motion'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import {
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual'
import { CalendarDays, Plus } from '@/icons/appIcons'
import { DisclosureChevron, StatusIndicator } from '@/icons/StatusIndicator'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import { buildDashboardStats } from '@/lib/dashboardStats'
import {
  buildStagePerformanceProjection,
  resolveStrategyStageScope,
  type StageScope,
} from '@/lib/stageArchive'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { registerTradeScrollTarget } from '@/lib/tradeScrollTargets'
import { TradeRow } from '@/components/trades/TradeRow'
import type { StrategyPreviewStats } from '@/components/RowPreviews'
import { StrategyIcon } from '@/components/StrategyIcon'
import { Tooltip } from '@/components/ui/Tooltip'
import { useStore } from '@/store/useStore'
import './TradeList.css'

export type TradeListGroup = {
  key: string
  label?: string
  tone?: 'pending' | 'completed' | 'neutral'
  /** 日期分组生命力底色：当前、近期、归档。 */
  recency?: 'current' | 'recent' | 'archive'
  /** 策略分组时传入，用于显示策略图标。 */
  strategyId?: string
  items: Trade[]
}

export type TradeListRowRenderContext = {
  focused: boolean
  strategyStats: StrategyPreviewStats | null
  symbolIcons: SymbolIconsMap
  ariaPosInSet: number
  ariaSetSize: number
  ariaDescribedBy?: string
}

type FlatItem =
  | {
      kind: 'header'
      key: string
      groupKey: string
      label: string
      count: number
      tone: NonNullable<TradeListGroup['tone']>
      recency?: TradeListGroup['recency']
      strategyId?: string
      expanded: boolean
    }
  | { kind: 'row'; key: string; trade: Trade; groupKey: string }

const ROW_HEIGHTS = {
  compact: 44,
  comfortable: 48,
} as const
const HEADER_CONTENT_HEIGHT = 36
const HEADER_VERTICAL_GAP = 8
const HEADER_HEIGHT = HEADER_CONTENT_HEIGHT + HEADER_VERTICAL_GAP
/** 只在数据或折叠意图改变时构建虚拟索引。 */
export function flattenGroups(
  groups: TradeListGroup[],
  collapsed: ReadonlySet<string> = new Set(),
): FlatItem[] {
  const items: FlatItem[] = []
  for (const group of groups) {
    const expanded = !collapsed.has(group.key)
    if (group.label) {
      items.push({
        kind: 'header',
        key: `h:${group.key}`,
        groupKey: group.key,
        label: group.label,
        count: group.items.length,
        tone: group.tone ?? 'neutral',
        recency: group.recency,
        strategyId: group.strategyId,
        expanded,
      })
    }
    if (!expanded) continue
    for (const trade of group.items) {
      items.push({
        kind: 'row',
        key: trade.id,
        trade,
        groupKey: group.key,
      })
    }
  }
  return items
}

function GroupLeadingIcon({
  tone,
  strategyId,
  strategies,
}: {
  tone: NonNullable<TradeListGroup['tone']>
  strategyId?: string
  strategies: Strategy[]
}) {
  if (strategyId) {
    const strategy = strategies.find((item) => item.id === strategyId)
    if (strategy) {
      return (
        <StrategyIcon
          icon={strategy.icon}
          color={strategy.color}
          size={ICON_SM}
          variant="nav"
          className="trade-list-group-icon"
        />
      )
    }
  }
  if (tone === 'pending') {
    return (
      <StatusIndicator
        state="todo"
        size={ICON_SM}
        color="var(--text-tertiary)"
        className="trade-list-group-icon"
      />
    )
  }
  if (tone === 'completed') {
    return (
      <StatusIndicator
        state="completed"
        size={ICON_SM}
        color="var(--status-completed)"
        className="trade-list-group-icon"
      />
    )
  }
  return <CalendarDays size={ICON_SM} className="trade-list-group-icon" />
}

export function TradeList({
  groups,
  strategies,
  focusedId,
  selectedIds,
  starredIds,
  scrollParentRef,
  onOpen,
  onSelect,
  onClearSelection,
  onToggleStar,
  onContextMenu,
  onCreate,
  recordLabel = '交易',
  mistakesFirst = false,
  renderRow,
  selectionEnabled = true,
  overscan = 14,
  strategyStageScope,
}: {
  groups: TradeListGroup[]
  strategies: Strategy[]
  focusedId: string | null
  selectedIds: Set<string>
  starredIds: string[]
  /** 外层 `.list-scroll`；未传则用本组件内查找 */
  scrollParentRef?: RefObject<HTMLElement | null>
  onOpen: (trade: Trade) => void
  onSelect: (trade: Trade) => void
  onClearSelection: () => void
  onToggleStar: (trade: Trade) => void
  onContextMenu: (event: React.MouseEvent, trade: Trade) => void
  onCreate: (group: { strategyId?: string; month?: string }) => void
  /** 分组新建按钮文案：交易 / 案例 */
  recordLabel?: string
  mistakesFirst?: boolean
  renderRow?: (trade: Trade, context: TradeListRowRenderContext) => ReactNode
  selectionEnabled?: boolean
  /** 预渲染行数；聚合视图可提高该值，保证快速滚动与返回定位稳定。 */
  overscan?: number
  /** 策略表现的显式 stage；paper/省略时保持当前实盘预览口径。 */
  strategyStageScope?: StageScope
}) {
  const listInstanceId = useId().replace(/:/g, '')
  const listRef = useRef<HTMLDivElement>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const starredSet = useMemo(() => new Set(starredIds), [starredIds])
  const symbolIcons = useStore((state) => state.symbolIcons) as SymbolIconsMap
  const allTrades = useStore((state) => state.trades)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const density = useStore((state) => state.display.listRowDensity)
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const businessDateAnchor = useBusinessDateAnchor()
  const rowHeight = ROW_HEIGHTS[density]
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const previousPositions = useRef<Map<string, number> | null>(null)
  const toggleGroup = (key: string, count: number) => {
    const list = listRef.current
    previousPositions.current = null
    if (count <= 3 && list && !reducesMotion()) {
      const positions = new Map<string, number>()
      for (const row of list.querySelectorAll<HTMLElement>('[data-motion-row]')) {
        const rect = row.getBoundingClientRect()
        if (rect.bottom >= 0 && rect.top <= window.innerHeight) positions.set(row.dataset.motionRow!, rect.top)
      }
      previousPositions.current = positions
    }
    setCollapsedGroups(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const flatItems = useMemo(() => flattenGroups(groups, collapsedGroups), [groups, collapsedGroups])
  const strategyPerformanceProjection = useMemo(
    () => buildStagePerformanceProjection({
      trades: allTrades,
      stageScope: resolveStrategyStageScope(strategyStageScope, currentLiveStageId),
      analysisScope: { kind: 'live', range: 'all' },
      anchor: businessDateAnchor,
      legacyCashCurrencyAssumption,
    }),
    [allTrades, businessDateAnchor, currentLiveStageId, legacyCashCurrencyAssumption, strategyStageScope],
  )
  const strategyStatsById = useMemo(
    () => new Map(
      buildDashboardStats(
        strategyPerformanceProjection.records,
        strategies,
        strategyPerformanceProjection.selection.eligibleMetricIds,
        tradingDayStartHour,
        strategyPerformanceProjection.selection.pnlIds,
      ).strategies.map((stats) => [stats.id, stats]),
    ),
    [strategies, strategyPerformanceProjection, tradingDayStartHour],
  )
  const stickyIndexes = useMemo(
    () =>
      flatItems
        .map((item, index) => (item.kind === 'header' ? index : -1))
        .filter((index) => index >= 0),
    [flatItems],
  )
  const pendingScrollTradeIdRef = useRef<string | null>(null)
  const activeStickyIndexRef = useRef(0)

  const getScrollElement = useCallback(() =>
    scrollParentRef?.current ?? listRef.current?.closest('.list-scroll') ?? null,
  [scrollParentRef])
  const estimateSize = useCallback((index: number) => {
    const item = flatItems[index]
    if (!item) return rowHeight
    if (item.kind === 'header') return HEADER_HEIGHT
    return rowHeight
  }, [flatItems, rowHeight])
  const rangeExtractor = useCallback((range: Range) => {
    // Headers are already ordered. Avoid copying and reversing all groups on
    // every scroll update; find the nearest preceding header in logarithmic time.
    let low = 0
    let high = stickyIndexes.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (stickyIndexes[middle] <= range.startIndex) low = middle + 1
      else high = middle
    }
    const stickyIndex = stickyIndexes[low - 1]
    activeStickyIndexRef.current = stickyIndex ?? 0
    const indexes = defaultRangeExtractor(range)
    if (stickyIndex !== undefined && stickyIndex < indexes[0]) indexes.unshift(stickyIndex)
    return indexes
  }, [stickyIndexes])

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getItemKey: useCallback((index: number) => flatItems[index].key, [flatItems]),
    getScrollElement,
    estimateSize,
    overscan,
    rangeExtractor,
  })

  useLayoutEffect(() => { virtualizer.measure() }, [rowHeight, virtualizer])

  // 仅连接两次布局中都在屏幕内的对象。先批量读，再交给合成器，不逐帧改行高。
  useLayoutEffect(() => {
    const before = previousPositions.current
    previousPositions.current = null
    const list = listRef.current
    if (!before || !list || reducesMotion()) return
    const moves: Array<[HTMLElement, number]> = []
    const nodes = list.querySelectorAll<HTMLElement>('[data-motion-row]')
    for (const node of nodes) {
      for (const previous of node.getAnimations()) {
        if (previous.id === 'atlas-group-move') previous.cancel()
      }
    }
    for (const node of nodes) {
      const start = before.get(node.dataset.motionRow!)
      if (start === undefined) continue
      const rect = node.getBoundingClientRect()
      const distance = start - rect.top
      if (Math.abs(distance) > 1 && Math.abs(distance) <= rowHeight * 3 && rect.bottom > 0 && rect.top < window.innerHeight) {
        moves.push([node, distance])
      }
    }
    for (const [node, distance] of moves) {
      playMotion(node, [{ transform: 'translateY(' + distance + 'px)' }, { transform: 'none' }], '--motion-dialog-in', 'atlas-group-move')
    }
  }, [flatItems, rowHeight])

  const ensureGroupExpandedForTrade = useCallback((tradeId: string) => {
    if (!collapsedGroups.size) return false
    const group = groups.find(item => collapsedGroups.has(item.key) && item.items.some(trade => trade.id === tradeId))
    if (!group) return false
    setCollapsedGroups(current => {
      const next = new Set(current)
      next.delete(group.key)
      return next
    })
    return true
  }, [groups, collapsedGroups])

  useEffect(() => {
    return registerTradeScrollTarget((tradeId) => {
      const exists = groups.some((group) => group.items.some((item) => item.id === tradeId))
      if (!exists) return false
      pendingScrollTradeIdRef.current = tradeId
      ensureGroupExpandedForTrade(tradeId)
      const index = flatItems.findIndex(
        (item) => item.kind === 'row' && item.trade.id === tradeId,
      )
      if (index >= 0) {
        pendingScrollTradeIdRef.current = null
        virtualizer.scrollToIndex(index, { align: 'center' })
      }
      return true
    })
  }, [groups, flatItems, ensureGroupExpandedForTrade, virtualizer])

  useEffect(() => {
    const tradeId = pendingScrollTradeIdRef.current
    if (!tradeId) return
    const index = flatItems.findIndex(
      (item) => item.kind === 'row' && item.trade.id === tradeId,
    )
    if (index < 0) return
    pendingScrollTradeIdRef.current = null
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [flatItems, virtualizer])

  const previousFocus = useRef<string | null>(null)
  useEffect(() => {
    const changed = previousFocus.current !== focusedId
    previousFocus.current = focusedId
    if (!focusedId) return
    if (changed && ensureGroupExpandedForTrade(focusedId)) {
      pendingScrollTradeIdRef.current = focusedId
      return
    }
    const index = flatItems.findIndex(
      (item) => item.kind === 'row' && item.trade.id === focusedId,
    )
    if (index < 0) return
    virtualizer.scrollToIndex(index, { align: 'auto' })
    const frame = requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-trade-id="${CSS.escape(focusedId)}"]`)
      row?.querySelector<HTMLButtonElement>('.trade-row-open')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedId, flatItems, ensureGroupExpandedForTrade, virtualizer])

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <>
      {selectionEnabled ? (
        <button
          type="button"
          className={'trade-list-mobile-select-toggle' + (selectionMode || selectedIds.size > 0 ? ' is-active' : '')}
          aria-pressed={selectionMode || selectedIds.size > 0}
          onClick={() => {
            if (selectionMode || selectedIds.size > 0) {
              setSelectionMode(false)
              onClearSelection()
            } else {
              setSelectionMode(true)
            }
          }}
        >
          {selectionMode || selectedIds.size > 0 ? '完成选择' : '选择'}
        </button>
      ) : null}
      <div
      className={
        'trade-list trade-list-virtual' +
        (density === 'comfortable' ? ' is-comfortable' : '') +
        (selectionMode || selectedIds.size > 0 ? ' is-selection-mode' : '')
      }
      role="list"
      aria-label={`${recordLabel}列表，共 ${flatItems.length - stickyIndexes.length} 条，${stickyIndexes.length} 个分组`}
      ref={listRef}
      style={{
        '--trade-row-height': `${rowHeight}px`,
        height: virtualizer.getTotalSize(),
        position: 'relative',
      } as CSSProperties}
    >
      {virtualItems.map((virtualRow) => {
        const item = flatItems[virtualRow.index]
        if (!item) return null
        const isSticky = item.kind === 'header' && virtualRow.index === activeStickyIndexRef.current
        const collapsed = item.kind === 'header' && !item.expanded
        const groupLabelId = `${listInstanceId}-group-${item.groupKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
        return (
          <div
            key={item.key}
            data-index={virtualRow.index}
            data-motion-row={item.key}
            className={
              'trade-list-virtual-item' +
              (item.kind === 'header' ? ' is-header' : ' is-row') +
              (isSticky ? ' is-sticky' : '')
            }
            role={item.kind === 'header' ? 'listitem' : 'presentation'}
            aria-posinset={item.kind === 'header' ? virtualRow.index + 1 : undefined}
            aria-setsize={item.kind === 'header' ? flatItems.length : undefined}
            style={{
              position: isSticky ? 'sticky' : 'absolute',
              top: isSticky ? 0 : virtualRow.start,
              left: 0,
              width: '100%',
              height: item.kind === 'header' ? HEADER_HEIGHT : rowHeight,
              zIndex: isSticky ? 3 : item.kind === 'header' ? 2 : 1,
              overflow: item.kind === 'header' ? 'hidden' : undefined,
            }}
          >
            {item.kind === 'header' ? (
              <div
                className={
                  'trade-list-group-header' +
                  (item.tone === 'pending' ? ' is-pending' : '') +
                  (item.tone === 'completed' ? ' is-completed' : '') +
                  (item.recency ? ` is-recency-${item.recency}` : '') +
                  (collapsed ? ' is-collapsed' : '')
                }
              >
                <button
                  type="button"
                  className="trade-list-group-toggle"
                  aria-expanded={item.expanded}
                  aria-label={
                    collapsed
                      ? `展开 ${item.label}（${item.count}）`
                      : `折叠 ${item.label}（${item.count}）`
                  }
                  onClick={() => toggleGroup(item.groupKey, item.count)}
                >
                  <span className="trade-list-group-chevron" aria-hidden="true">
                    <DisclosureChevron />
                  </span>
                  <span className="trade-list-group-status" aria-hidden="true">
                    <GroupLeadingIcon
                      tone={item.tone}
                      strategyId={item.strategyId}
                      strategies={strategies}
                    />
                  </span>
                  <strong id={groupLabelId}>{item.label}</strong>
                  <span className="trade-list-group-count">{item.count}</span>
                </button>
                <Tooltip asChild content={`在本组新建${recordLabel}`} label={`在本组新建${recordLabel}`}>
                  <button
                    type="button"
                    className="trade-list-group-add"
                    onClick={() => onCreate({ strategyId: item.strategyId, month: /^\d{4}-\d{2}$/.test(item.groupKey) ? item.groupKey : undefined })}
                    aria-label={`在本组新建${recordLabel}`}
                  >
                    <Plus size={ICON_MD} />
                  </button>
                </Tooltip>
              </div>
            ) : renderRow ? (
              renderRow(item.trade, {
                focused: item.trade.id === focusedId,
                strategyStats: strategyStatsById.get(item.trade.strategyId) ?? null,
                symbolIcons,
                ariaPosInSet: virtualRow.index + 1,
                ariaSetSize: flatItems.length,
                ariaDescribedBy: groupLabelId,
              })
            ) : (
              <TradeRow
                trade={item.trade}
                mistakesFirst={mistakesFirst}
                strategies={strategies}
                strategyStats={strategyStatsById.get(item.trade.strategyId) ?? null}
                symbolIcons={symbolIcons}
                focused={item.trade.id === focusedId}
                selected={selectedIds.has(item.trade.id)}
                starred={starredSet.has(item.trade.id)}
                selectable={selectionEnabled}
                ariaPosInSet={virtualRow.index + 1}
                ariaSetSize={flatItems.length}
                ariaDescribedBy={groupLabelId}
                onOpen={onOpen}
                onSelect={onSelect}
                onToggleStar={onToggleStar}
                onContextMenu={onContextMenu}
              />
            )}
          </div>
        )
      })}
      </div>
    </>
  )
}

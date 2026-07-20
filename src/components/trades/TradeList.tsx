import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual'
import { CalendarDays, Plus } from '@/icons/appIcons'
import { LinearChevronIcon, LinearIssueStatusIcon } from '@/icons/linear'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import { buildDashboardStats } from '@/lib/dashboardStats'
import { registerTradeScrollTarget } from '@/lib/tradeScrollTargets'
import { TradeRow } from '@/components/trades/TradeRow'
import { StrategyIcon } from '@/components/StrategyIcon'
import { useStore } from '@/store/useStore'
import './TradeList.css'

export type TradeListGroup = {
  key: string
  label?: string
  tone?: 'pending' | 'completed' | 'neutral'
  /** 日期分组生命力底色（Linear Started / Todo / Backlog 同构） */
  recency?: 'current' | 'recent' | 'archive'
  /** 策略分组时传入，用于显示策略图标（对齐 Linear 项目分组） */
  strategyId?: string
  items: Trade[]
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
      /** 1=展开，0=折叠 */
      openProgress: number
    }
  | { kind: 'row'; key: string; trade: Trade; groupKey: string; openProgress: number }

const ROW_HEIGHT = 44
const HEADER_HEIGHT = 36
/** Linear 布局尺寸变化：~ease-out-quart */
const COLLAPSE_MS = 260
const EASE_OUT_QUART = (t: number) => 1 - (1 - t) ** 4

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 将分组展平为虚拟列表项；openProgress≤0 的分组只保留表头 */
export function flattenGroups(
  groups: TradeListGroup[],
  openProgressByGroup: ReadonlyMap<string, number> = new Map(),
): FlatItem[] {
  const items: FlatItem[] = []
  for (const group of groups) {
    const openProgress = openProgressByGroup.get(group.key) ?? 1
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
        openProgress,
      })
    }
    if (openProgress <= 0.001) continue
    for (const trade of group.items) {
      items.push({
        kind: 'row',
        key: trade.id,
        trade,
        groupKey: group.key,
        openProgress,
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
          size={14}
          variant="nav"
          className="trade-list-group-icon"
        />
      )
    }
  }
  if (tone === 'pending') {
    return (
      <LinearIssueStatusIcon
        state="todo"
        size={14}
        color="var(--text-tertiary)"
        className="trade-list-group-icon"
      />
    )
  }
  if (tone === 'completed') {
    return (
      <LinearIssueStatusIcon
        state="completed"
        size={14}
        color="var(--status-completed)"
        className="trade-list-group-icon"
      />
    )
  }
  return <CalendarDays size={14} className="trade-list-group-icon" />
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
  onToggleStar,
  onContextMenu,
  onCreate,
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
  onToggleStar: (trade: Trade) => void
  onContextMenu: (event: React.MouseEvent, trade: Trade) => void
  onCreate: () => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const symbolIcons = useStore((state) => state.symbolIcons) as SymbolIconsMap
  const allTrades = useStore((state) => state.trades)
  /** 分组展开进度 0..1；缺省视为 1 */
  const [openProgressByGroup, setOpenProgressByGroup] = useState<Map<string, number>>(
    () => new Map(),
  )
  const openProgressRef = useRef(openProgressByGroup)
  openProgressRef.current = openProgressByGroup
  const animFrameRef = useRef<number | null>(null)
  const animatingRef = useRef<
    Map<string, { from: number; to: number; startedAt: number }>
  >(new Map())

  const getOpenProgress = useCallback(
    (groupKey: string) => openProgressByGroup.get(groupKey) ?? 1,
    [openProgressByGroup],
  )

  const tickAnimations = useCallback(() => {
    const now = performance.now()
    const next = new Map(openProgressRef.current)
    let active = false
    for (const [groupKey, anim] of animatingRef.current) {
      const raw = Math.min(1, Math.max(0, (now - anim.startedAt) / COLLAPSE_MS))
      const t = EASE_OUT_QUART(raw)
      const value = anim.from + (anim.to - anim.from) * t
      if (raw >= 1) {
        next.set(groupKey, anim.to)
        animatingRef.current.delete(groupKey)
      } else {
        next.set(groupKey, value)
        active = true
      }
    }
    setOpenProgressByGroup(next)
    if (active) {
      animFrameRef.current = requestAnimationFrame(tickAnimations)
    } else {
      animFrameRef.current = null
    }
  }, [])

  const animateGroupTo = useCallback(
    (groupKey: string, to: number) => {
      if (prefersReducedMotion()) {
        animatingRef.current.delete(groupKey)
        setOpenProgressByGroup((current) => {
          const next = new Map(current)
          next.set(groupKey, to)
          return next
        })
        return
      }
      const from = openProgressRef.current.get(groupKey) ?? 1
      if (Math.abs(from - to) < 0.001) {
        setOpenProgressByGroup((current) => {
          const next = new Map(current)
          next.set(groupKey, to)
          return next
        })
        return
      }
      animatingRef.current.set(groupKey, {
        from,
        to,
        startedAt: performance.now(),
      })
      if (animFrameRef.current == null) {
        animFrameRef.current = requestAnimationFrame(tickAnimations)
      }
    },
    [tickAnimations],
  )

  useEffect(() => {
    return () => {
      if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  const toggleGroup = useCallback(
    (groupKey: string) => {
      const current = openProgressRef.current.get(groupKey) ?? 1
      const closing = current > 0.5
      animateGroupTo(groupKey, closing ? 0 : 1)
    },
    [animateGroupTo],
  )

  const flatItems = useMemo(
    () => flattenGroups(groups, openProgressByGroup),
    [groups, openProgressByGroup],
  )
  const strategyStatsById = useMemo(
    () => new Map(
      buildDashboardStats(
        allTrades.filter((trade) => !trade.deletedAt && trade.tradeKind === 'live'),
        strategies,
      ).strategies.map((stats) => [stats.id, stats]),
    ),
    [allTrades, strategies],
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

  const getScrollElement = () =>
    scrollParentRef?.current ?? listRef.current?.closest('.list-scroll') ?? null

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement,
    estimateSize: (index) => {
      const item = flatItems[index]
      if (!item) return ROW_HEIGHT
      if (item.kind === 'header') return HEADER_HEIGHT
      return Math.max(0, ROW_HEIGHT * item.openProgress)
    },
    overscan: 14,
    rangeExtractor: (range: Range) => {
      activeStickyIndexRef.current =
        [...stickyIndexes].reverse().find((index) => range.startIndex >= index) ?? 0
      const next = new Set([
        activeStickyIndexRef.current,
        ...defaultRangeExtractor(range),
      ])
      return [...next].sort((a, b) => a - b)
    },
  })

  useEffect(() => {
    virtualizer.measure()
  }, [openProgressByGroup, flatItems.length, virtualizer])

  const ensureGroupExpandedForTrade = useCallback(
    (tradeId: string) => {
      const owningGroup = groups.find((group) =>
        group.items.some((item) => item.id === tradeId),
      )
      if (!owningGroup) return false
      if (getOpenProgress(owningGroup.key) > 0.99) return false
      animateGroupTo(owningGroup.key, 1)
      return true
    },
    [groups, getOpenProgress, animateGroupTo],
  )

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

  useEffect(() => {
    if (!focusedId) return
    if (ensureGroupExpandedForTrade(focusedId)) {
      pendingScrollTradeIdRef.current = focusedId
      return
    }
    const index = flatItems.findIndex(
      (item) => item.kind === 'row' && item.trade.id === focusedId,
    )
    if (index < 0) return
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [focusedId, flatItems, ensureGroupExpandedForTrade, virtualizer])

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      className="trade-list trade-list-virtual"
      role="list"
      ref={listRef}
      style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
    >
      {virtualItems.map((virtualRow) => {
        const item = flatItems[virtualRow.index]
        if (!item) return null
        const isSticky = item.kind === 'header' && virtualRow.index === activeStickyIndexRef.current
        const collapsed = item.kind === 'header' && item.openProgress < 0.5
        const rowOpacity =
          item.kind === 'row' ? Math.min(1, item.openProgress * 1.35) : 1
        return (
          <div
            key={item.key}
            data-index={virtualRow.index}
            className={
              'trade-list-virtual-item' +
              (item.kind === 'header' ? ' is-header' : ' is-row') +
              (isSticky ? ' is-sticky' : '') +
              (item.kind === 'row' && item.openProgress < 0.999 ? ' is-collapsing' : '')
            }
            style={{
              position: isSticky ? 'sticky' : 'absolute',
              top: isSticky ? 0 : virtualRow.start,
              left: 0,
              width: '100%',
              height: virtualRow.size,
              zIndex: isSticky ? 3 : item.kind === 'header' ? 2 : 1,
              opacity: rowOpacity,
              overflow: 'hidden',
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
                  aria-expanded={item.openProgress > 0.5}
                  aria-label={
                    collapsed
                      ? `展开 ${item.label}（${item.count}）`
                      : `折叠 ${item.label}（${item.count}）`
                  }
                  onClick={() => toggleGroup(item.groupKey)}
                >
                  <span className="trade-list-group-chevron" aria-hidden="true">
                    <LinearChevronIcon
                      style={{
                        transform: `rotate(${90 * item.openProgress}deg)`,
                      }}
                    />
                  </span>
                  <span className="trade-list-group-status" aria-hidden="true">
                    <GroupLeadingIcon
                      tone={item.tone}
                      strategyId={item.strategyId}
                      strategies={strategies}
                    />
                  </span>
                  <strong>{item.label}</strong>
                  <span className="trade-list-group-count">{item.count}</span>
                </button>
                <button
                  type="button"
                  className="trade-list-group-add"
                  onClick={() => onCreate()}
                  aria-label="在本组新建交易"
                >
                  <Plus size={16} />
                </button>
              </div>
            ) : (
              <TradeRow
                trade={item.trade}
                strategies={strategies}
                strategyStats={strategyStatsById.get(item.trade.strategyId) ?? null}
                symbolIcons={symbolIcons}
                focused={item.trade.id === focusedId}
                selected={selectedIds.has(item.trade.id)}
                starred={starredIds.includes(item.trade.id)}
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
  )
}

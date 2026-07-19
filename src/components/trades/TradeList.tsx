import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual'
import { CalendarDays, Plus } from '@/icons/appIcons'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import { registerTradeScrollTarget } from '@/lib/tradeScrollTargets'
import { TradeRow } from '@/components/trades/TradeRow'
import { useStore } from '@/store/useStore'
import './TradeList.css'

export type TradeListGroup = {
  key: string
  label?: string
  items: Trade[]
}

type FlatItem =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; trade: Trade }

const ROW_HEIGHT = 44
const HEADER_HEIGHT = 36

function flattenGroups(groups: TradeListGroup[]): FlatItem[] {
  const items: FlatItem[] = []
  for (const group of groups) {
    if (group.label) {
      items.push({
        kind: 'header',
        key: `h:${group.key}`,
        label: group.label,
        count: group.items.length,
      })
    }
    for (const trade of group.items) {
      items.push({ kind: 'row', key: trade.id, trade })
    }
  }
  return items
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
  const flatItems = useMemo(() => flattenGroups(groups), [groups])
  const stickyIndexes = useMemo(
    () =>
      flatItems
        .map((item, index) => (item.kind === 'header' ? index : -1))
        .filter((index) => index >= 0),
    [flatItems],
  )
  const activeStickyIndexRef = useRef(0)

  const getScrollElement = () =>
    scrollParentRef?.current ?? listRef.current?.closest('.list-scroll') ?? null

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement,
    estimateSize: (index) => (flatItems[index]?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT),
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
    return registerTradeScrollTarget((tradeId) => {
      const index = flatItems.findIndex(
        (item) => item.kind === 'row' && item.trade.id === tradeId,
      )
      if (index < 0) return false
      virtualizer.scrollToIndex(index, { align: 'center' })
      return true
    })
  }, [flatItems, virtualizer])

  useEffect(() => {
    if (!focusedId) return
    const index = flatItems.findIndex(
      (item) => item.kind === 'row' && item.trade.id === focusedId,
    )
    if (index < 0) return
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [focusedId, flatItems, virtualizer])

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
        return (
          <div
            key={item.key}
            data-index={virtualRow.index}
            className={
              'trade-list-virtual-item' +
              (item.kind === 'header' ? ' is-header' : '') +
              (isSticky ? ' is-sticky' : '')
            }
            style={{
              position: isSticky ? 'sticky' : 'absolute',
              top: isSticky ? 0 : 0,
              left: 0,
              width: '100%',
              height: virtualRow.size,
              zIndex: isSticky ? 3 : item.kind === 'header' ? 2 : 1,
              transform: isSticky ? undefined : `translateY(${virtualRow.start}px)`,
            }}
          >
            {item.kind === 'header' ? (
              <header className="trade-list-group-header">
                <CalendarDays size={14} className="trade-list-group-icon" aria-hidden="true" />
                <span>{item.label}</span>
                <span className="trade-list-group-count">{item.count}</span>
                <button type="button" onClick={() => onCreate()} aria-label="在本组新建交易">
                  <Plus size={14} />
                </button>
              </header>
            ) : (
              <TradeRow
                trade={item.trade}
                strategies={strategies}
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

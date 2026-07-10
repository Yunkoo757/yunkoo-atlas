import { Plus } from 'lucide-react'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { TradeRow } from '@/components/trades/TradeRow'
import './TradeList.css'

export type TradeListGroup = {
  key: string
  label?: string
  items: Trade[]
}

export function TradeList({
  groups,
  strategies,
  focusedId,
  selectedIds,
  starredIds,
  followedIds,
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
  followedIds: string[]
  onOpen: (trade: Trade) => void
  onSelect: (trade: Trade) => void
  onToggleStar: (trade: Trade) => void
  onContextMenu: (event: React.MouseEvent, trade: Trade) => void
  onCreate: () => void
}) {
  return (
    <div className="trade-list" role="list">
      {groups.map((group) => (
        <section className="trade-list-group" key={group.key}>
          {group.label && (
            <header className="trade-list-group-header">
              <span>{group.label}</span>
              <span className="trade-list-group-count">{group.items.length}</span>
              <button type="button" onClick={onCreate} aria-label="在本组新建交易">
                <Plus size={14} />
              </button>
            </header>
          )}
          {group.items.map((trade) => (
            <TradeRow
              key={trade.id}
              trade={trade}
              strategies={strategies}
              focused={trade.id === focusedId}
              selected={selectedIds.has(trade.id)}
              starred={starredIds.includes(trade.id)}
              followed={followedIds.includes(trade.id)}
              onOpen={onOpen}
              onSelect={onSelect}
              onToggleStar={onToggleStar}
              onContextMenu={onContextMenu}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

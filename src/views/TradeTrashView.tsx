import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import {
  type Trade,
  STATUS_META,
  TRADE_KIND_META,
  CONVICTION_META,
  isTradeDeleted,
  getTradeRemainingDays,
} from '@/data/trades'
import { fmtDate, fmtMoney, fmtR } from '@/lib/format'
import { getStrategyName } from '@/lib/strategies'
import { Trash2, RotateCcw, AlertTriangle, CheckSquare, Square } from '@/icons/appIcons'
import { toast } from '@/lib/toast'
import { EmptyState } from '@/components/EmptyState'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { StrategyLabel } from '@/components/StrategyIcon'
import './TrashView.css'

type TrashGroup = { label: string; items: Trade[]; priority: number }

function groupTrash(trades: Trade[]): TrashGroup[] {
  const groups = new Map<string, { items: Trade[]; priority: number }>()

  for (const t of trades) {
    const days = getTradeRemainingDays(t)
    let label: string
    let priority: number

    if (days <= 7) {
      label = '即将过期'
      priority = 0
    } else if (days <= 14) {
      label = '本周删除'
      priority = 1
    } else if (days <= 21) {
      label = '本月删除'
      priority = 2
    } else {
      label = '更早'
      priority = 3
    }

    if (!groups.has(label)) {
      groups.set(label, { items: [], priority })
    }
    groups.get(label)!.items.push(t)
  }

  return Array.from(groups.entries())
    .map(([label, data]) => ({ label, ...data }))
    .sort((a, b) => a.priority - b.priority)
}

export function TradeTrashView() {
  const navigate = useNavigate()
  const allTrades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const restoreTrade = useStore((s) => s.restoreTrade)
  const purgeTrade = useStore((s) => s.purgeTrade)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  const trashTrades = useMemo(() => {
    return allTrades.filter((t) => isTradeDeleted(t) && getTradeRemainingDays(t) > 0)
  }, [allTrades])

  const filteredTrades = useMemo(() => {
    if (!searchQuery.trim()) return trashTrades

    const query = searchQuery.toLowerCase()
    return trashTrades.filter((t) => {
      const ref = t.ref.toLowerCase()
      const symbol = t.symbol.toLowerCase()
      const strategyName = getStrategyName(strategies, t.strategyId).toLowerCase()
      const statusLabel = STATUS_META[t.status]?.label.toLowerCase()

      return ref.includes(query) ||
             symbol.includes(query) ||
             strategyName.includes(query) ||
             statusLabel.includes(query)
    })
  }, [trashTrades, searchQuery, strategies])

  const groups = useMemo(() => groupTrash(filteredTrades), [filteredTrades])

  const handleRestore = (id: string) => {
    restoreTrade(id)
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    toast('已恢复交易')
  }

  const handlePurge = (id: string) => {
    const confirmed = window.confirm('彻底删除后无法恢复，确定继续？')
    if (!confirmed) return

    purgeTrade(id)
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    toast('已彻底删除')
  }

  const handleBatchRestore = () => {
    if (selected.size === 0) return
    const count = selected.size
    selected.forEach((id) => restoreTrade(id))
    setSelected(new Set())
    toast(`已恢复 ${count} 笔交易`)
  }

  const handleBatchPurge = () => {
    if (selected.size === 0) return
    const confirmed = window.confirm(`彻底删除 ${selected.size} 笔交易后无法恢复，确定继续？`)
    if (!confirmed) return

    const count = selected.size
    selected.forEach((id) => purgeTrade(id))
    setSelected(new Set())
    toast(`已彻底删除 ${count} 笔交易`)
  }

  const handleSelectAll = () => {
    if (selected.size === filteredTrades.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredTrades.map((t) => t.id)))
    }
  }

  const handleToggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleBack = () => {
    navigate('/list')
  }

  return (
    <div className="trash-view">
      <header className="topbar">
        <div className="tb-left">
          <button className="trash-back-btn" onClick={handleBack}>
            ← 交易列表
          </button>
          <span className="tb-title">回收站 ({trashTrades.length})</span>
        </div>
        {selected.size > 0 && (
          <div className="tb-right">
            <button className="trash-batch-btn trash-batch-restore" onClick={handleBatchRestore}>
              <RotateCcw size={14} />
              <span>恢复 ({selected.size})</span>
            </button>
            <button className="trash-batch-btn trash-batch-purge" onClick={handleBatchPurge}>
              <Trash2 size={14} />
              <span>彻底删除 ({selected.size})</span>
            </button>
          </div>
        )}
      </header>

      {trashTrades.length > 0 && (
        <div className="trash-search">
          <input
            type="text"
            placeholder="搜索交易ID、标的、策略、状态..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="trash-search-input"
          />
          {searchQuery && (
            <button className="trash-search-clear" onClick={() => setSearchQuery('')}>
              ×
            </button>
          )}
        </div>
      )}

      <div className="trash-content">
        {filteredTrades.length === 0 ? (
          <EmptyState
            title={searchQuery ? '未找到匹配交易' : '回收站为空'}
            hint={searchQuery ? '尝试其他搜索关键词' : '已删除的交易会在 30 天后自动清空'}
          />
        ) : (
          <div className="trash-groups">
            <div className="trash-select-all">
              <button className="trash-select-all-btn" onClick={handleSelectAll}>
                {selected.size === filteredTrades.length ? (
                  <CheckSquare size={16} />
                ) : (
                  <Square size={16} />
                )}
                <span>
                  {selected.size === filteredTrades.length ? '取消全选' : '全选'}
                </span>
              </button>
              {searchQuery && (
                <span className="trash-search-count">
                  找到 {filteredTrades.length} 笔交易
                </span>
              )}
            </div>

            {groups.map((group) => (
              <div key={group.label} className="trash-group">
                <div className="trash-group-header">
                  <span className="trash-group-label">{group.label}</span>
                  <span className="trash-group-count">{group.items.length}</span>
                </div>

                <div className="trash-items">
                  {group.items.map((trade) => {
                    const days = getTradeRemainingDays(trade)
                    const isUrgent = days <= 7
                    const isSelected = selected.has(trade.id)
                    const strategyName = getStrategyName(strategies, trade.strategyId)

                    return (
                      <div key={trade.id} className={`trash-item ${isUrgent ? 'is-urgent' : ''} ${isSelected ? 'is-selected' : ''}`}>
                        <div className="trash-item-checkbox">
                          <button onClick={() => handleToggleSelect(trade.id)}>
                            {isSelected ? (
                              <CheckSquare size={16} />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        </div>

                        <div className="trash-item-main">
                          <div className="trash-item-id">{trade.ref}</div>
                          <div className={`trash-item-days ${isUrgent ? 'is-urgent' : ''}`}>
                            {isUrgent && <AlertTriangle size={12} />}
                            <span>剩余 {days} 天</span>
                          </div>
                        </div>

                        <div className="trash-item-body">
                          <div className="trash-item-meta">
                            <span className="trash-item-symbol">{trade.symbol}</span>
                            <SideTag side={trade.side} />
                            <StatusIcon status={trade.status} />
                            <ConvictionIcon conviction={trade.conviction} />
                            <StrategyLabel strategyId={trade.strategyId} strategies={strategies} />
                          </div>

                          <div className="trash-item-info">
                            <span className="trash-item-pnl">{fmtMoney(trade.pnl)}</span>
                            <span className="trash-item-r">{fmtR(trade.rMultiple)}</span>
                            <span className="trash-item-kind">{TRADE_KIND_META[trade.tradeKind].label}</span>
                          </div>

                          <div className="trash-item-date">
                            删除于 {fmtDate(trade.deletedAt!)}
                          </div>
                        </div>

                        <div className="trash-item-actions">
                          <button
                            className="trash-btn-restore"
                            onClick={() => handleRestore(trade.id)}
                          >
                            <RotateCcw size={14} />
                            <span>恢复</span>
                          </button>
                          <button
                            className="trash-btn-purge"
                            onClick={() => handlePurge(trade.id)}
                          >
                            <Trash2 size={14} />
                            <span>彻底删除</span>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

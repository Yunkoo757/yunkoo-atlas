import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import {
  type Trade,
  STATUS_META,
  isTradeDeleted,
  getTradeRemainingDays,
} from '@/data/trades'
import { fmtDate, fmtMoney, fmtR } from '@/lib/format'
import { getStrategyName } from '@/lib/strategies'
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Search,
  X,
} from '@/icons/appIcons'
import { toast } from '@/lib/toast'
import { EmptyState } from '@/components/EmptyState'
import { StatusIcon, SideTag } from '@/components/StatusIcon'
import { StrategyLabel } from '@/components/StrategyIcon'
import { BatchActionBar } from '@/components/ui/BatchActionBar'
import { CrumbsNav } from '@/components/ui/CrumbsNav'
import { SelectionBox } from '@/components/ui/SelectionBox'
import { Tooltip } from '@/components/ui/Tooltip'
import { useWorkbenchListKeyboard } from '@/hooks/useWorkbenchListKeyboard'
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

  useWorkbenchListKeyboard({
    items: filteredTrades,
    selectedIds: selected,
    setSelectedIds: setSelected,
  })

  return (
    <div className="trash-view">
      <CrumbsNav
        backLabel="返回交易日志"
        onBack={handleBack}
        crumbs={[
          { label: '交易日志' },
          { label: '回收站', active: true },
        ]}
        context={`${trashTrades.length} 笔 · 保留 30 天`}
      />

      <div className="trash-content">
        {filteredTrades.length === 0 ? (
          <EmptyState
            title={searchQuery ? '未找到匹配交易' : '回收站为空'}
            hint={searchQuery ? '尝试其他搜索关键词' : '已删除的交易会在 30 天后自动清空'}
          />
        ) : (
          <div className="trash-groups">
            <div className="trash-selection-bar">
              <label className="trash-search">
                <Search size={14} />
                <input
                  type="search"
                  aria-label="搜索回收站"
                  placeholder="搜索回收站"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="trash-search-input"
                />
                {searchQuery && (
                  <button type="button" className="trash-search-clear" aria-label="清除搜索" onClick={() => setSearchQuery('')}>
                    <X size={13} />
                  </button>
                )}
              </label>
              <button
                type="button"
                className="trash-select-all-btn"
                onClick={handleSelectAll}
                aria-pressed={selected.size === filteredTrades.length && filteredTrades.length > 0}
              >
                <SelectionBox
                  checked={selected.size === filteredTrades.length && filteredTrades.length > 0}
                  alwaysVisible
                  label={
                    selected.size === filteredTrades.length && filteredTrades.length > 0
                      ? '取消全选'
                      : '全选'
                  }
                  onToggle={handleSelectAll}
                />
                <span>
                  {selected.size === filteredTrades.length && filteredTrades.length > 0
                    ? '取消全选'
                    : '全选'}
                </span>
              </button>
              {searchQuery && (
                <span className="trash-search-count">
                  找到 {filteredTrades.length} 笔交易
                </span>
              )}
              {!searchQuery && (
                <span className="trash-search-count">共 {filteredTrades.length} 笔</span>
              )}
            </div>

            {groups.map((group) => (
              <div key={group.label} className="trash-group">
                <div className="trash-group-header">
                  <span className="trash-group-label">{group.label}</span>
                  <span className="trash-group-count">{group.items.length}</span>
                </div>

                <div className="trash-items" role="list">
                  {group.items.map((trade) => {
                    const days = getTradeRemainingDays(trade)
                    const isUrgent = days <= 7
                    const isSelected = selected.has(trade.id)
                    const pnlTone =
                      trade.pnl > 0 ? ' is-positive' : trade.pnl < 0 ? ' is-negative' : ''

                    return (
                      <div
                        key={trade.id}
                        role="listitem"
                        className={
                          'trash-item' +
                          (isUrgent ? ' is-urgent' : '') +
                          (isSelected ? ' is-selected' : '')
                        }
                      >
                        <SelectionBox
                          checked={isSelected}
                          label={`${isSelected ? '取消选择' : '选择'} ${trade.ref}`}
                          onToggle={() => handleToggleSelect(trade.id)}
                          className="trash-row-check"
                        />

                        <span className="trash-item-status">
                          <StatusIcon status={trade.status} />
                        </span>
                        <span className="trash-item-id">{trade.ref}</span>

                        <div className="trash-item-trade">
                          <div className="trash-item-meta">
                            <strong className="trash-item-symbol">{trade.symbol}</strong>
                            <SideTag side={trade.side} quiet />
                            <StrategyLabel
                              strategyId={trade.strategyId}
                              strategies={strategies}
                              size={14}
                            />
                          </div>
                        </div>

                        <span className={'trash-item-pnl' + pnlTone}>{fmtMoney(trade.pnl)}</span>
                        <span className="trash-item-r">{fmtR(trade.rMultiple)}</span>
                        <span className="trash-item-date">{fmtDate(trade.deletedAt!)}</span>
                        <div
                          className={'trash-item-days' + (isUrgent ? ' is-urgent' : '')}
                          title={`${days} 天后自动清空`}
                        >
                          {isUrgent && <AlertTriangle size={11} />}
                          <span>{days} 天</span>
                        </div>

                        <div className="trash-item-actions">
                          <Tooltip content="恢复" label={`恢复 ${trade.ref}`}>
                            <button
                              type="button"
                              className="trash-btn-restore"
                              aria-label={`恢复 ${trade.ref}`}
                              onClick={() => handleRestore(trade.id)}
                            >
                              <RotateCcw size={14} />
                            </button>
                          </Tooltip>
                          <Tooltip content="永久删除" label={`永久删除 ${trade.ref}`}>
                            <button
                              type="button"
                              className="trash-btn-purge"
                              aria-label={`永久删除 ${trade.ref}`}
                              onClick={() => handlePurge(trade.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </Tooltip>
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

      <BatchActionBar count={selected.size}>
        <button type="button" className="batch-action-btn" onClick={handleBatchRestore}>
          <RotateCcw size={14} />
          <span>恢复</span>
        </button>
        <button
          type="button"
          className="batch-action-btn batch-action-btn-danger"
          onClick={handleBatchPurge}
        >
          <Trash2 size={14} />
          <span>彻底删除</span>
        </button>
      </BatchActionBar>
    </div>
  )
}

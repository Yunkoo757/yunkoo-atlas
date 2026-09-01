import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, type TradePurgeTarget } from '@/store/useStore'
import {
  type Trade,
  STATUS_META,
  isTradeDeleted,
  getTradeRemainingDays,
} from '@/data/trades'
import { fmtDate, fmtMoney, fmtR } from '@/lib/format'
import { formatTradeCashPnl } from '@/lib/cashCurrency'
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
import { ModalShell } from '@/components/ui/ModalShell'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { useWorkbenchListKeyboard } from '@/hooks/useWorkbenchListKeyboard'
import './TrashView.css'
import { flushPersistNow } from '@/storage/persist'
import { getJournalBridge, isElectron } from '@/storage/runtime'

type TrashGroup = { label: string; items: Trade[]; priority: number }
type PurgeRequest =
  | { kind: 'single'; targets: TradePurgeTarget[]; ref: string }
  | { kind: 'batch'; targets: TradePurgeTarget[] }

function capturePurgeTarget(trade: Trade): TradePurgeTarget | null {
  if (!trade.deletedAt) return null
  return {
    id: trade.id,
    expectedDeletedAt: trade.deletedAt,
    expectedDeletionId: trade.deletionId,
  }
}

function groupTrash(trades: Trade[]): TrashGroup[] {
  const groups = new Map<string, { items: Trade[]; priority: number }>()

  for (const t of trades) {
    const days = getTradeRemainingDays(t)
    let label: string
    let priority: number

    if (days === null) {
      label = '删除时间异常'
      priority = 0
    } else if (days === 0) {
      label = '已满 30 天'
      priority = 1
    } else if (days <= 7) {
      label = '已删除 3 周以上'
      priority = 2
    } else if (days <= 14) {
      label = '已删除 2 周以上'
      priority = 3
    } else if (days <= 21) {
      label = '已删除 1 周以上'
      priority = 4
    } else {
      label = '最近删除'
      priority = 5
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
  const privacyMode = useStore((s) => s.display.privacyMode)
  const legacyCashCurrencyAssumption = useStore((s) => s.profile.legacyCashCurrencyAssumption)
  const restoreTrade = useStore((s) => s.restoreTrade)
  const restoreTrades = useStore((s) => s.restoreTrades)
  const purgeTrades = useStore((s) => s.purgeTrades)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [purgeRequest, setPurgeRequest] = useState<PurgeRequest | null>(null)
  const [contextMenu, setContextMenu] = useState<CtxState | null>(null)

  const trashTrades = useMemo(() => {
    return allTrades.filter(isTradeDeleted)
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

  const requestPurge = (trade: Trade) => {
    const target = capturePurgeTarget(trade)
    if (!target) return
    setPurgeRequest({ kind: 'single', targets: [target], ref: trade.ref })
  }

  const confirmPurge = async () => {
    if (!purgeRequest) return
    if (isElectron()) {
      try {
        await flushPersistNow()
        const bridge = getJournalBridge()
        const recoveryPoint = await bridge!.createBackup()
        if (!recoveryPoint) throw new Error('无法创建删除前恢复点')
        const verification = await bridge!.verifyBackup(recoveryPoint)
        if (verification.status !== 'verified') {
          throw new Error(verification.error ?? '删除前恢复点校验失败')
        }
      } catch (error) {
        toast(error instanceof Error ? `${error.message}，已停止删除` : '无法验证删除前恢复点，已停止删除')
        return
      }
    }
    const result = purgeTrades(purgeRequest.targets)
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of result.purgedIds) next.delete(id)
      return next
    })
    setPurgeRequest(null)
    if (result.staleIds.length > 0 || result.notInTrashIds.length > 0) {
      toast(
        result.purgedIds.length > 0
          ? `已彻底删除 ${result.purgedIds.length} 笔；另有 ${result.staleIds.length + result.notInTrashIds.length} 笔状态已变化，未执行删除`
          : '交易状态已变化，已停止删除；请重新检查后再试',
      )
    } else if (result.blockedIds.length > 0) {
      toast(
        result.purgedIds.length > 0
          ? `已彻底删除 ${result.purgedIds.length} 笔；另有 ${result.blockedIds.length} 笔被旧版完成周复盘引用，请重新打开并完成对应复盘后再试`
          : '该交易被旧版完成周复盘引用；请重新打开并完成对应复盘后再彻底删除',
      )
    } else {
      toast(result.purgedIds.length === 1 ? '已彻底删除' : `已彻底删除 ${result.purgedIds.length} 笔交易`)
    }
  }

  const handleBatchRestore = () => {
    if (selected.size === 0) return
    const count = selected.size
    restoreTrades([...selected])
    setSelected(new Set())
    toast(`已恢复 ${count} 笔交易`)
  }

  const handleBatchPurge = () => {
    if (selected.size === 0) return
    const targets = trashTrades
      .filter((trade) => selected.has(trade.id))
      .map(capturePurgeTarget)
      .filter((target): target is TradePurgeTarget => target !== null)
    if (targets.length === 0) return
    setPurgeRequest({ kind: 'batch', targets })
  }

  const openContextMenu = (event: React.MouseEvent, trade: Trade) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      originElement: event.currentTarget as HTMLElement,
      items: [
        {
          type: 'label',
          text: '回收站操作',
        },
        {
          type: 'item',
          icon: <RotateCcw size={ICON_MD} />,
          label: '恢复记录',
          onClick: () => handleRestore(trade.id),
        },
        { type: 'divider' },
        {
          type: 'item',
          icon: <Trash2 size={ICON_MD} />,
          label: '彻底删除',
          danger: true,
          onClick: () => requestPurge(trade),
        },
      ],
    })
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
    navigate(-1)
  }

  useWorkbenchListKeyboard({
    items: filteredTrades,
    selectedIds: selected,
    setSelectedIds: setSelected,
  })

  return (
    <div className="trash-view">
      <CrumbsNav
        backLabel="返回"
        onBack={handleBack}
        crumbs={[{ label: '回收站', active: true }]}
        context={trashTrades.length > 0 ? `${trashTrades.length} 笔` : undefined}
      />

      <div className="trash-content">
        {trashTrades.length === 0 ? (
          <EmptyState
            title="回收站为空"
            hint="已删除的交易会保留，直到你明确选择彻底删除"
          />
        ) : (
          <div className="trash-groups">
            <div className="trash-selection-bar">
              <label className="trash-search">
                <Search size={ICON_SM} />
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
                    <X size={ICON_SM} />
                  </button>
                )}
              </label>
              <div className="trash-select-all-btn">
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
                <button type="button" className="trash-select-all-label" onClick={handleSelectAll}>
                  {selected.size === filteredTrades.length && filteredTrades.length > 0
                    ? '取消全选'
                    : '全选'}
                </button>
              </div>
              {selected.size === 0 && searchQuery && (
                <span className="trash-search-count">
                  找到 {filteredTrades.length} 笔交易
                </span>
              )}
              {selected.size === 0 && !searchQuery && (
                <span className="trash-search-count">共 {filteredTrades.length} 笔</span>
              )}
              <BatchActionBar count={selected.size} placement="inline">
                <button type="button" className="batch-bar-action-btn" onClick={handleBatchRestore}>
                  <RotateCcw size={ICON_SM} />
                  <span>恢复</span>
                </button>
                <button
                  type="button"
                  className="batch-bar-action-btn batch-bar-action-btn-danger"
                  onClick={handleBatchPurge}
                >
                  <Trash2 size={ICON_SM} />
                  <span>彻底删除</span>
                </button>
                <button type="button" className="batch-bar-action-btn" onClick={() => setSelected(new Set())}>
                  <X size={ICON_SM} />
                  <span>取消选择</span>
                </button>
              </BatchActionBar>
            </div>

            {filteredTrades.length === 0 ? (
              <EmptyState
                title="未找到匹配交易"
                hint="尝试其他搜索关键词"
              />
            ) : groups.map((group) => (
              <div key={group.label} className="trash-group">
                <div className="trash-group-header">
                  <span className="trash-group-label">{group.label}</span>
                  <span className="trash-group-count">{group.items.length}</span>
                </div>

                <div className="trash-items" role="list">
                  {group.items.map((trade) => {
                    const days = getTradeRemainingDays(trade)
                    const isUrgent = days !== null && days <= 3
                    const isSelected = selected.has(trade.id)
                    const pnlTone = privacyMode ? '' :
                      trade.pnl != null && trade.pnl > 0 ? ' is-positive' : trade.pnl != null && trade.pnl < 0 ? ' is-negative' : ''

                    return (
                      <div
                        key={trade.id}
                        role="listitem"
                        onContextMenu={(event) => openContextMenu(event, trade)}
                        className="trash-item"
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
                        <span className="trash-item-id" title={trade.ref}>{trade.ref}</span>

                        <div className="trash-item-trade">
                          <div className="trash-item-meta">
                            <strong className="trash-item-symbol">{trade.symbol}</strong>
                            <SideTag side={trade.side} quiet />
                            <StrategyLabel
                              strategyId={trade.strategyId}
                              strategies={strategies}
                              size={ICON_SM}
                            />
                          </div>
                        </div>

                        <span className={'trash-item-pnl' + pnlTone}>{formatTradeCashPnl(trade, legacyCashCurrencyAssumption, privacyMode)}</span>
                        <span className="trash-item-r">{fmtR(trade.rMultiple)}</span>
                        <span className="trash-item-date">{days === null ? '时间异常' : fmtDate(trade.deletedAt!)}</span>
                        <div className={'trash-item-days' + (isUrgent ? ' is-urgent' : '')}>
                          {isUrgent && <AlertTriangle size={ICON_SM} />}
                          <span>{days === null ? '需核对' : days === 0 ? '已满 30 天' : `剩余 ${days} 天`}</span>
                        </div>

                        <div className="trash-item-actions">
                          <Tooltip content="恢复" label={`恢复 ${trade.ref}`}>
                            <button
                              type="button"
                              className="trash-btn-restore"
                              aria-label={`恢复 ${trade.ref}`}
                              onClick={() => handleRestore(trade.id)}
                            >
                              <RotateCcw size={ICON_SM} />
                            </button>
                          </Tooltip>
                          <Tooltip content="彻底删除" label={`彻底删除 ${trade.ref}`}>
                            <button
                              type="button"
                              className="trash-btn-purge"
                              aria-label={`彻底删除 ${trade.ref}`}
                              onClick={() => requestPurge(trade)}
                            >
                              <Trash2 size={ICON_SM} />
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

      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />

      {purgeRequest ? (
        <ModalShell
          size="compact"
          title={purgeRequest.kind === 'single'
            ? `彻底删除 ${purgeRequest.ref}？`
            : `彻底删除 ${purgeRequest.targets.length} 笔交易？`}
          description="删除后无法恢复，交易及其复盘内容会被永久移除。"
          onClose={() => setPurgeRequest(null)}
          footer={(
            <>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus
                onClick={() => setPurgeRequest(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-danger-solid"
                onClick={confirmPurge}
              >
                彻底删除
              </button>
            </>
          )}
        />
      ) : null}
    </div>
  )
}

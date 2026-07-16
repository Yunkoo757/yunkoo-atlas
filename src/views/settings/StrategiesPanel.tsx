import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, ChevronRight } from '@/icons/appIcons'
import { StrategyIcon } from '@/components/StrategyIcon'
import { StrategyFormModal, uniqueStrategyId } from '@/components/StrategyFormModal'
import { useStore } from '@/store/useStore'
import {
  computeStrategyStats,
  countStrategyReferences,
  formatStrategyMetricCoverage,
} from '@/lib/strategies'
import { fmtR } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { Strategy } from '@/data/strategies'
import { Tooltip } from '@/components/ui/Tooltip'
import { Select } from '@/components/ui/Select'
import '@/views/StrategiesView.css'

export function StrategiesPanel() {
  const strategies = useStore((s) => s.strategies)
  const trades = useStore((s) => s.trades)
  const addStrategy = useStore((s) => s.addStrategy)
  const updateStrategy = useStore((s) => s.updateStrategy)
  const removeStrategy = useStore((s) => s.removeStrategy)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Strategy | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Strategy | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [reassignId, setReassignId] = useState('')

  const rows = useMemo(
    () =>
      [...strategies]
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map((s) => {
          const stats = computeStrategyStats(trades, s.id, { tradeKind: 'live' })
          return {
            ...s,
            count: stats.tradeCount,
            linkedCount: countStrategyReferences(trades, s.id),
            pnlCoverage: formatStrategyMetricCoverage(stats.pnlCount, stats.closedCount),
            rCoverage: formatStrategyMetricCoverage(stats.rCount, stats.closedCount),
            pendingResultCount: Math.max(
              0,
              stats.closedCount - stats.evaluatedCount - stats.conflictCount,
            ),
            stats,
          }
        }),
    [strategies, trades],
  )

  const existingNames = strategies.map((s) => s.name)

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (s: Strategy) => {
    setEditing(s)
    setModalOpen(true)
  }

  const onSave = (data: Omit<Strategy, 'id'>, id?: string) => {
    if (id) {
      updateStrategy(id, data)
      toast('策略已更新')
    } else {
      const newId = uniqueStrategyId(data.name, strategies)
      addStrategy({ ...data, id: newId })
      toast('策略已创建')
    }
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const others = strategies.filter((s) => s.id !== deleteTarget.id)
    if (deleteCount > 0 && others.length === 0) {
      toast('至少保留一个策略')
      return
    }
    const targetId = deleteCount > 0 ? reassignId || others[0]?.id : undefined
    if (deleteCount > 0 && !targetId) {
      toast('请选择迁移目标策略')
      return
    }
    removeStrategy(deleteTarget.id, targetId)
    toast('策略已删除')
    setDeleteTarget(null)
    setReassignId('')
  }

  return (
    <>
      <div className="settings-page strategies-panel">
        <div className="settings-page-head st-head">
          <div>
            <h1 className="settings-page-title">交易策略</h1>
            <p className="settings-page-desc">
              维护策略分类、图标与配色，并查看每种策略的实盘执行表现。
            </p>
          </div>
          <button type="button" className="st-add" onClick={openCreate}>
            <Plus size={16} />
            <span>新建策略</span>
          </button>
        </div>

        <div className="st-list">
          {rows.map((s) => (
            <div className="st-row" key={s.id}>
              <StrategyIcon icon={s.icon} color={s.color} size={18} />
              <div className="st-row-main">
                <Link to={`/strategy/${s.id}`} className="st-row-name" style={{ color: s.color }}>
                  {s.name}
                </Link>
                <span className="st-row-meta">{s.count} 笔实盘交易</span>
                <div className="st-row-stats">
                  <span>{s.stats.winRate == null ? '胜率 —' : `${s.stats.winRate.toFixed(0)}% 胜率`}</span>
                  <span>{s.stats.totalR == null ? '总R —' : `${fmtR(s.stats.totalR)} 总R`}</span>
                  <span>{s.stats.averageR == null ? '均R —' : `${fmtR(s.stats.averageR)} 均R`}</span>
                  <span>{s.stats.reviewedCount}/{s.stats.tradeCount} 已复盘</span>
                  {s.pnlCoverage && <span>盈亏 {s.pnlCoverage}</span>}
                  {s.rCoverage && <span>R {s.rCoverage}</span>}
                  {s.pendingResultCount > 0 && <span>{s.pendingResultCount} 笔待补结果</span>}
                  {s.stats.conflictCount > 0 && <span>{s.stats.conflictCount} 笔结果冲突</span>}
                </div>
                {s.stats.topMistakes.length > 0 && (
                  <div className="st-row-mistakes">
                    {s.stats.topMistakes.map((m) => (
                      <span key={m.tag}>{m.tag} ×{m.count}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="st-row-actions">
                <Tooltip content="编辑" label={`编辑 ${s.name}`}>
                  <button type="button" className="st-act" aria-label={`编辑 ${s.name}`} onClick={() => openEdit(s)}>
                    <Pencil size={15} />
                  </button>
                </Tooltip>
                <Tooltip content="删除" label={`删除 ${s.name}`}>
                  <button
                    type="button"
                    className="st-act st-act-danger"
                    aria-label={`删除 ${s.name}`}
                    onClick={() => {
                      setDeleteTarget(s)
                      setDeleteCount(s.linkedCount)
                      setReassignId(strategies.find((x) => x.id !== s.id)?.id ?? '')
                    }}
                    disabled={strategies.length <= 1}
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
                <Tooltip content="查看交易" label={`查看 ${s.name} 交易`}>
                  <Link to={`/strategy/${s.id}`} className="st-act" aria-label={`查看 ${s.name} 交易`}>
                    <ChevronRight size={15} />
                  </Link>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      </div>

      <StrategyFormModal
        open={modalOpen}
        initial={editing}
        existingNames={existingNames}
        onClose={() => setModalOpen(false)}
        onSave={onSave}
      />

      {deleteTarget && (
        <div
          className="st-del-overlay"
          role="presentation"
          onMouseDown={() => setDeleteTarget(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDeleteTarget(null)
          }}
        >
          <div
            className="st-del"
            role="dialog"
            aria-modal="true"
            aria-labelledby="strategy-delete-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="strategy-delete-title">删除策略「{deleteTarget.name}」？</h3>
            {deleteCount > 0 ? (
              <>
                <p>
                  该策略下有 <b>{deleteCount}</b> 笔交易，删除前需迁移到其他策略。
                </p>
                <Select
                  className="st-del-select"
                  value={reassignId}
                  onValueChange={setReassignId}
                  ariaLabel="迁移到策略"
                  options={strategies
                    .filter((s) => s.id !== deleteTarget.id)
                    .map((strategy) => ({ value: strategy.id, label: strategy.name }))}
                />
              </>
            ) : (
              <p>此策略下没有交易，可直接删除。</p>
            )}
            <div className="st-del-foot">
              <button type="button" className="st-del-btn" onClick={() => setDeleteTarget(null)} autoFocus>
                取消
              </button>
              <button type="button" className="st-del-btn st-del-danger" onClick={confirmDelete}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

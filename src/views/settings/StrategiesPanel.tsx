import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'
import { StrategyIcon } from '@/components/StrategyIcon'
import { StrategyFormModal, uniqueStrategyId } from '@/components/StrategyFormModal'
import { useStore } from '@/store/useStore'
import { computeStrategyStats } from '@/lib/strategies'
import { fmtR } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { Strategy } from '@/data/strategies'
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
          const stats = computeStrategyStats(trades, s.id)
          return {
            ...s,
            count: stats.tradeCount,
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
              维护策略分类、图标与配色。查看案例请用 Ctrl+K 搜索策略名，或在列表开启「按策略分组」。
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
                <span className="st-row-meta">{s.count} 笔交易</span>
                <div className="st-row-stats">
                  <span>{s.stats.closedCount ? `${s.stats.winRate.toFixed(0)}% 胜率` : '胜率 —'}</span>
                  <span>{s.stats.closedCount ? `${fmtR(s.stats.totalR)} 总R` : '总R —'}</span>
                  <span>{s.stats.closedCount ? `${fmtR(s.stats.averageR)} 均R` : '均R —'}</span>
                  <span>{s.stats.reviewedCount}/{s.stats.tradeCount} 已复盘</span>
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
                <button type="button" className="st-act" title="编辑" onClick={() => openEdit(s)}>
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="st-act st-act-danger"
                  title="删除"
                  onClick={() => {
                    setDeleteTarget(s)
                    setDeleteCount(s.count)
                    setReassignId(strategies.find((x) => x.id !== s.id)?.id ?? '')
                  }}
                  disabled={strategies.length <= 1}
                >
                  <Trash2 size={15} />
                </button>
                <Link to={`/strategy/${s.id}`} className="st-act" title="查看交易">
                  <ChevronRight size={15} />
                </Link>
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
        <div className="st-del-overlay" onMouseDown={() => setDeleteTarget(null)}>
          <div className="st-del" onMouseDown={(e) => e.stopPropagation()}>
            <h3>删除策略「{deleteTarget.name}」？</h3>
            {deleteCount > 0 ? (
              <>
                <p>
                  该策略下有 <b>{deleteCount}</b> 笔交易，删除前需迁移到其他策略。
                </p>
                <select
                  className="st-del-select"
                  value={reassignId}
                  onChange={(e) => setReassignId(e.target.value)}
                >
                  {strategies
                    .filter((s) => s.id !== deleteTarget.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <p>此策略下没有交易，可直接删除。</p>
            )}
            <div className="st-del-foot">
              <button type="button" className="st-del-btn" onClick={() => setDeleteTarget(null)}>
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

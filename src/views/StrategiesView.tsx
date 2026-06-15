import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, ChevronRight, HardDriveDownload, Pin } from 'lucide-react'
import { Topbar } from '@/components/Topbar'
import { StrategyIcon } from '@/components/StrategyIcon'
import { StrategyFormModal, uniqueStrategyId } from '@/components/StrategyFormModal'
import { DataIOModal } from '@/components/DataIOModal'
import { useStore } from '@/store/useStore'
import { countTradesByStrategy, sortStrategies } from '@/lib/strategies'
import { toast } from '@/lib/toast'
import type { Strategy } from '@/data/strategies'
import './StrategiesView.css'

export function StrategiesView() {
  const strategies = useStore((s) => s.strategies)
  const pinnedStrategyIds = useStore((s) => s.pinnedStrategyIds)
  const trades = useStore((s) => s.trades)
  const addStrategy = useStore((s) => s.addStrategy)
  const updateStrategy = useStore((s) => s.updateStrategy)
  const removeStrategy = useStore((s) => s.removeStrategy)
  const togglePinStrategy = useStore((s) => s.togglePinStrategy)
  const isPinnedStrategy = useStore((s) => s.isPinnedStrategy)

  const [modalOpen, setModalOpen] = useState(false)
  const [dataIOOpen, setDataIOOpen] = useState(false)
  const [editing, setEditing] = useState<Strategy | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Strategy | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [reassignId, setReassignId] = useState('')

  const rows = useMemo(
    () =>
      sortStrategies(strategies, pinnedStrategyIds).map((s) => ({
        ...s,
        count: countTradesByStrategy(trades, s.id),
      })),
    [strategies, pinnedStrategyIds, trades],
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
      <Topbar title="策略管理" showDisplay={false} />
      <div className="st-scroll">
        <div className="st-head">
          <div>
            <h1 className="st-title">交易策略</h1>
            <p className="st-sub">管理策略分类、图标与配色，交易将按策略归档与统计。</p>
          </div>
          <button className="st-add" onClick={openCreate}>
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
              </div>
              <div className="st-row-actions">
                <button
                  className={'st-act' + (isPinnedStrategy(s.id) ? ' st-act-pinned' : '')}
                  title={isPinnedStrategy(s.id) ? '取消置顶侧栏' : '置顶侧栏'}
                  onClick={() => togglePinStrategy(s.id)}
                >
                  <Pin size={15} />
                </button>
                <button className="st-act" title="编辑" onClick={() => openEdit(s)}>
                  <Pencil size={15} />
                </button>
                <button
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

        <div className="st-foot">
          <button className="st-io" onClick={() => setDataIOOpen(true)}>
            <HardDriveDownload size={16} />
            <span>导入/导出数据</span>
          </button>
        </div>
      </div>

      <StrategyFormModal
        open={modalOpen}
        initial={editing}
        existingNames={existingNames}
        onClose={() => setModalOpen(false)}
        onSave={onSave}
      />

      <DataIOModal open={dataIOOpen} onClose={() => setDataIOOpen(false)} />

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
              <button className="st-del-btn" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button className="st-del-btn st-del-danger" onClick={confirmDelete}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

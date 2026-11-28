import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, ChevronRight } from '@/icons/appIcons'
import { StrategyIcon, strategySelectOption } from '@/components/StrategyIcon'
import { StrategyFormModal, uniqueStrategyId } from '@/components/StrategyFormModal'
import { useStore } from '@/store/useStore'
import { countStrategyReferences } from '@/lib/strategies'
import { toast } from '@/lib/toast'
import type { Strategy } from '@/data/strategies'
import { Tooltip } from '@/components/ui/Tooltip'
import { Select } from '@/components/ui/Select'
import { ModalShell } from '@/components/ui/ModalShell'
import '@/views/StrategiesView.css'

export function StrategiesPanel() {
  const strategies = useStore((s) => s.strategies)
  const trades = useStore((s) => s.trades)
  const projects = useStore((s) => s.backtestProjects)
  const addStrategy = useStore((s) => s.addStrategy)
  const updateStrategy = useStore((s) => s.updateStrategy)
  const removeStrategy = useStore((s) => s.removeStrategy)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Strategy | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Strategy | null>(null)
  const [reassignId, setReassignId] = useState('')

  const rows = useMemo(
    () =>
      [...strategies]
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map((strategy) => ({
          ...strategy,
          linkedCount: countStrategyReferences(trades, strategy.id),
        })),
    [strategies, trades],
  )

  const existingNames = strategies.map((s) => s.name)
  const deleteCount = deleteTarget ? countStrategyReferences(trades, deleteTarget.id) : 0
  const projectCount = deleteTarget ? projects.filter(project => project.defaultStrategyId === deleteTarget.id).length : 0
  const destinations = deleteTarget ? strategies.filter(strategy => strategy.id !== deleteTarget.id) : []
  const destination = destinations.length === 1 ? destinations[0] : destinations.find(strategy => strategy.id === reassignId)

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
      toast('策略已更新', { tone: 'success' })
    } else {
      const newId = uniqueStrategyId(data.name, strategies)
      addStrategy({ ...data, id: newId })
      toast('策略已创建', { tone: 'success' })
    }
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    if (deleteCount > 0 && !destination) return
    if (!removeStrategy(deleteTarget.id, deleteCount > 0 ? destination?.id : undefined)) {
      toast('策略或关联记录已变化，请重新核对', { tone: 'warning' })
      return
    }
    toast('策略已删除', { tone: 'success' })
    setDeleteTarget(null)
    setReassignId('')
  }

  return (
    <>
      <div className="settings-page settings-page--form strategies-panel">
        <div className="settings-page-head st-head">
          <h1 className="settings-page-title">策略</h1>
          <button type="button" className="ui-btn ui-btn-bordered ui-btn-sm st-add-button" onClick={openCreate}>
            <Plus size={ICON_SM} />
            <span>新建策略</span>
          </button>
        </div>

        <div className="settings-card st-list">
          {rows.map((s) => (
            <div className="st-row" key={s.id}>
              <StrategyIcon icon={s.icon} color={s.color} size={ICON_MD} />
              <div className="st-row-main">
                <Link to={`/strategy/${s.id}`} className="st-row-name">
                  {s.name}
                </Link>
                <span className="st-row-meta">{s.linkedCount} 笔关联交易</span>
              </div>
              <div className="st-row-actions">
                <Tooltip content="编辑" label={`编辑 ${s.name}`}>
                  <button type="button" className="st-act" aria-label={`编辑 ${s.name}`} onClick={() => openEdit(s)}>
                    <Pencil size={ICON_SM} />
                  </button>
                </Tooltip>
                <Tooltip content="删除" label={`删除 ${s.name}`}>
                  <button
                    type="button"
                    className="st-act st-act-danger"
                    aria-label={`删除 ${s.name}`}
                    onClick={() => {
                      setDeleteTarget(s)
                      setReassignId('')
                    }}
                    disabled={strategies.length <= 1}
                  >
                    <Trash2 size={ICON_SM} />
                  </button>
                </Tooltip>
                <Tooltip content="查看交易" label={`查看 ${s.name} 交易`}>
                  <Link to={`/strategy/${s.id}`} className="st-act" aria-label={`查看 ${s.name} 交易`}>
                    <ChevronRight size={ICON_SM} />
                  </Link>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      </div>

      {modalOpen && (
        <StrategyFormModal
          initial={editing}
          existingNames={existingNames}
          onClose={() => setModalOpen(false)}
          onSave={onSave}
        />
      )}

      {deleteTarget ? (
        <ModalShell
          title={`删除策略「${deleteTarget.name}」？`}
          size="compact"
          onClose={() => {
            setDeleteTarget(null)
            setReassignId('')
          }}
          footer={(
            <>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus
                onClick={() => {
                  setDeleteTarget(null)
                  setReassignId('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-danger-solid"
                disabled={destinations.length === 0 || (deleteCount > 0 && !destination)}
                onClick={confirmDelete}
              >
                {deleteCount > 0 ? '迁移并删除' : '删除'}
              </button>
            </>
          )}
        >
          {deleteCount > 0 ? (
            <>
              <p>
                {deleteCount} 条关联记录{projectCount > 0 && `及 ${projectCount} 个回测项目的默认策略`}
                {destinations.length === 1 ? `将迁移到「${destination?.name}」。` : '需要迁移，选择接收它们的策略。'}
              </p>
              {destinations.length > 1 && <Select
                className="st-del-select"
                placeholder="选择迁移目标"
                value={reassignId}
                onValueChange={setReassignId}
                ariaLabel="迁移到策略"
                options={destinations.map(strategySelectOption)}
              />}
            </>
          ) : (
            <p>{projectCount > 0 ? `将清除 ${projectCount} 个回测项目的默认策略。` : '此策略没有关联记录。'}</p>
          )}
        </ModalShell>
      ) : null}
    </>
  )
}

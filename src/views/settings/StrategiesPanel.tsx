import { ICON_MD } from '@/icons/iconSize'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, ChevronRight } from '@/icons/appIcons'
import { StrategyIcon } from '@/components/StrategyIcon'
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
        .map((strategy) => ({
          ...strategy,
          linkedCount: countStrategyReferences(trades, strategy.id),
        })),
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
      <div className="settings-page settings-page--reading strategies-panel">
        <div className="settings-page-head st-head">
          <div>
            <h1 className="settings-page-title">交易策略</h1>
          </div>
          <button type="button" className="ui-btn ui-btn-bordered st-add-button" onClick={openCreate}>
            <Plus size={ICON_MD} />
            <span>新建策略</span>
          </button>
        </div>

        <div className="st-list">
          {rows.map((s) => (
            <div className="st-row" key={s.id}>
              <StrategyIcon icon={s.icon} color={s.color} size={ICON_MD} variant="nav" />
              <div className="st-row-main">
                <Link to={`/strategy/${s.id}`} className="st-row-name">
                  {s.name}
                </Link>
                <span className="st-row-meta">{s.linkedCount} 笔关联交易</span>
              </div>
              <div className="st-row-actions">
                <Tooltip content="编辑" label={`编辑 ${s.name}`}>
                  <button type="button" className="st-act" aria-label={`编辑 ${s.name}`} onClick={() => openEdit(s)}>
                    <Pencil size={ICON_MD} />
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
                    <Trash2 size={ICON_MD} />
                  </button>
                </Tooltip>
                <Tooltip content="查看交易" label={`查看 ${s.name} 交易`}>
                  <Link to={`/strategy/${s.id}`} className="st-act" aria-label={`查看 ${s.name} 交易`}>
                    <ChevronRight size={ICON_MD} />
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
                onClick={confirmDelete}
              >
                删除
              </button>
            </>
          )}
        >
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
        </ModalShell>
      ) : null}
    </>
  )
}

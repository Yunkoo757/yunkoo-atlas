import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import {
  type CaseRecord,
  type DisputeType,
  deriveLifecycle,
  deriveOutcome,
  formatCaseId,
  getDisputeType,
  getRemainingDays,
  OUTCOME_COLORS,
} from '@/data/case'
import { fmtDate } from '@/lib/format'
import { Trash2, RotateCcw, AlertTriangle, Star, Camera, FileText, CheckSquare, Square } from 'lucide-react'
import { toast } from '@/lib/toast'
import { EmptyState } from '@/components/EmptyState'
import './TrashView.css'

type TrashGroup = { label: string; items: CaseRecord[]; priority: number }

function groupTrash(cases: CaseRecord[], disputeTypes: DisputeType[]): TrashGroup[] {
  const groups = new Map<string, { items: CaseRecord[]; priority: number }>()

  for (const c of cases) {
    const days = getRemainingDays(c)
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
    groups.get(label)!.items.push(c)
  }

  // Sort by priority
  return Array.from(groups.entries())
    .map(([label, data]) => ({ label, ...data }))
    .sort((a, b) => a.priority - b.priority)
}

export function TrashView() {
  const navigate = useNavigate()
  const allCases = useStore((s) => s.cases)
  const disputeTypes = useStore((s) => s.disputeTypes)
  const restoreCase = useStore((s) => s.restoreCase)
  const purgeCase = useStore((s) => s.purgeCase)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  // Filter deleted cases that are not expired
  const trashCases = useMemo(() => {
    return allCases.filter((c) => c.deletedAt && getRemainingDays(c) > 0)
  }, [allCases])

  // Apply search filter
  const filteredCases = useMemo(() => {
    if (!searchQuery.trim()) return trashCases

    const query = searchQuery.toLowerCase()
    return trashCases.filter((c) => {
      const dt = getDisputeType(c.disputeTypeId, disputeTypes)
      const caseId = formatCaseId(c.id).toLowerCase()
      const typeName = (dt?.name ?? '').toLowerCase()
      const lifecycle = deriveLifecycle(c).toLowerCase()
      const note = (c.note ?? '').toLowerCase()

      return (
        caseId.includes(query) ||
        typeName.includes(query) ||
        lifecycle.includes(query) ||
        note.includes(query)
      )
    })
  }, [trashCases, searchQuery, disputeTypes])

  const groups = useMemo(() => {
    return groupTrash(filteredCases, disputeTypes)
  }, [filteredCases, disputeTypes])

  const handleRestore = (id: string) => {
    restoreCase(id)
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    toast('已恢复案例')
  }

  const handlePurge = (id: string) => {
    const confirmed = window.confirm('彻底删除后无法恢复，确定继续？')
    if (!confirmed) return

    purgeCase(id)
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
    selected.forEach((id) => restoreCase(id))
    setSelected(new Set())
    toast(`已恢复 ${count} 个案例`)
  }

  const handleBatchPurge = () => {
    if (selected.size === 0) return
    const confirmed = window.confirm(`彻底删除 ${selected.size} 个案例后无法恢复，确定继续？`)
    if (!confirmed) return

    const count = selected.size
    selected.forEach((id) => purgeCase(id))
    setSelected(new Set())
    toast(`已彻底删除 ${count} 个案例`)
  }

  const handleSelectAll = () => {
    if (selected.size === filteredCases.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredCases.map((c) => c.id)))
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
    navigate('/cases')
  }

  return (
    <div className="trash-view">
      <header className="topbar">
        <div className="tb-left">
          <button className="trash-back-btn" onClick={handleBack}>
            ← 判例库
          </button>
          <span className="tb-title">回收站 ({trashCases.length})</span>
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

      {trashCases.length > 0 && (
        <div className="trash-search">
          <input
            type="text"
            placeholder="搜索案例ID、纠纷类型、裁决结果..."
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
        {filteredCases.length === 0 ? (
          <EmptyState
            title={searchQuery ? '未找到匹配案例' : '回收站为空'}
            hint={searchQuery ? '尝试其他搜索关键词' : '已删除的案例会在 30 天后自动清空'}
          />
        ) : (
          <div className="trash-groups">
            <div className="trash-select-all">
              <button className="trash-select-all-btn" onClick={handleSelectAll}>
                {selected.size === filteredCases.length ? (
                  <CheckSquare size={16} />
                ) : (
                  <Square size={16} />
                )}
                <span>
                  {selected.size === filteredCases.length ? '取消全选' : '全选'}
                </span>
              </button>
              {searchQuery && (
                <span className="trash-search-count">
                  找到 {filteredCases.length} 个案例
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
                  {group.items.map((rec) => {
                    const dt = getDisputeType(rec.disputeTypeId, disputeTypes)
                    const lifecycle = deriveLifecycle(rec)
                    const outcome = deriveOutcome(rec, dt)
                    const days = getRemainingDays(rec)
                    const isUrgent = days <= 7
                    const isSelected = selected.has(rec.id)

                    return (
                      <div key={rec.id} className={`trash-item ${isUrgent ? 'is-urgent' : ''} ${isSelected ? 'is-selected' : ''}`}>
                        <div className="trash-item-checkbox">
                          <button onClick={() => handleToggleSelect(rec.id)}>
                            {isSelected ? (
                              <CheckSquare size={16} />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        </div>

                        <div className="trash-item-main">
                          <div className="trash-item-id">{formatCaseId(rec.id)}</div>
                          <div className={`trash-item-days ${isUrgent ? 'is-urgent' : ''}`}>
                            {isUrgent && <AlertTriangle size={12} />}
                            <span>剩余 {days} 天</span>
                          </div>
                        </div>

                        <div className="trash-item-body">
                          <div className="trash-item-meta">
                            <span className="trash-item-type">{dt?.name ?? '未知类型'}</span>
                            <span className={`trash-item-outcome-dot ${OUTCOME_COLORS[outcome].dot}`} />
                            <span className="trash-item-lifecycle">{lifecycle}</span>
                            {rec.star && <Star size={12} fill="currentColor" className="trash-item-star" />}
                          </div>

                          <div className="trash-item-info">
                            {rec.images.length > 0 && (
                              <span className="trash-item-badge">
                                <Camera size={12} />
                                {rec.images.length}
                              </span>
                            )}
                            {rec.note && (
                              <span className="trash-item-badge">
                                <FileText size={12} />
                              </span>
                            )}
                          </div>

                          <div className="trash-item-date">
                            删除于 {fmtDate(rec.deletedAt!)}
                          </div>
                        </div>

                        <div className="trash-item-actions">
                          <button
                            className="trash-btn-restore"
                            onClick={() => handleRestore(rec.id)}
                            title="恢复案例"
                          >
                            <RotateCcw size={14} />
                            <span>恢复</span>
                          </button>
                          <button
                            className="trash-btn-purge"
                            onClick={() => handlePurge(rec.id)}
                            title="彻底删除"
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
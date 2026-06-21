import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Topbar } from '@/components/Topbar'
import { useStore } from '@/store/useStore'
import {
  type CaseRecord,
  type DisputeType,
  deriveLifecycle,
  deriveOutcome,
  formatCaseId,
  getDisputeType,
  OUTCOME_COLORS,
} from '@/data/case'
import { fmtDate } from '@/lib/format'
import { Star, AlertTriangle, Trash2, Plus } from 'lucide-react'
import { toast } from '@/lib/toast'
import { CaseDetail } from './CaseDetail'
import './CaseList.css'

type GroupedCases = { label: string; items: CaseRecord[] }[]

function groupCases(cases: CaseRecord[], disputeTypes: DisputeType[]): GroupedCases {
  const groups = new Map<string, CaseRecord[]>()
  const order: string[] = []

  for (const c of cases) {
    const lifecycle = deriveLifecycle(c)
    const outcome = deriveOutcome(c, getDisputeType(c.disputeTypeId, disputeTypes))
    // 已裁决按 outcome 分子组
    const key = lifecycle === '已裁决' ? `已裁决 · ${OUTCOME_COLORS[outcome].label}` : lifecycle
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(c)
  }

  // 排序：待验证 → 已裁决各组 → 已废弃
  const priority = (k: string) => {
    if (k === '待验证') return 0
    if (k.startsWith('已裁决')) return 1
    return 2
  }
  order.sort((a, b) => priority(a) - priority(b))

  return order.map((label) => ({ label, items: groups.get(label)! }))
}

function CaseCard({
  rec,
  disputeTypes,
  selected,
  onToggle,
  onDelete,
  onClick,
}: {
  rec: CaseRecord
  disputeTypes: DisputeType[]
  selected: boolean
  onToggle: () => void
  onDelete: () => void
  onClick: () => void
}) {
  const dt = getDisputeType(rec.disputeTypeId, disputeTypes)
  const outcome = deriveOutcome(rec, dt)
  const colors = OUTCOME_COLORS[outcome]
  const caseId = formatCaseId(rec.id)
  const abbrev = (dt?.name ?? '??').slice(0, 2).toUpperCase()

  return (
    <div
      className={'cl-card' + (selected ? ' is-selected' : '')}
      onClick={onClick}
    >
      <span
        className={'cl-check' + (selected ? ' is-visible' : '')}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
      >
        {selected ? '✓' : ''}
      </span>
      <span className="cl-icon" style={{ background: colors.bg, color: colors.dot }}>
        {abbrev}
      </span>
      <div className="cl-body">
        <div className="cl-title-row">
          <span className="cl-id">{caseId}</span>
          <span className="cl-type">{dt?.name ?? '未知类型'}</span>
          {rec.star && <span className="cl-flag cl-flag-star">典型</span>}
          {rec.recheck && <span className="cl-flag cl-flag-recheck">复看</span>}
        </div>
        <div className="cl-meta-row">
          <span className="cl-chip">{rec.confidence}%</span>
          <span className="cl-chip">{rec.images.length}图</span>
          {rec.tags?.slice(0, 3).map((t) => (
            <span className="cl-chip" key={t}>{t}</span>
          ))}
          {rec.note && (
            <span className="cl-note">{rec.note}</span>
          )}
        </div>
      </div>
      <span className="cl-outcome">
        <span className="cl-dot" style={{ background: colors.dot }} />
        {colors.label}
      </span>
      <span className="cl-date">{fmtDate(rec.updatedAt)}</span>
      <button
        className="cl-del"
        title="删除判例"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

export function CaseList() {
  const cases = useStore((s) => s.cases)
  const disputeTypes = useStore((s) => s.disputeTypes)
  const removeCase = useStore((s) => s.removeCase)
  const setCaseModalOpen = useStore((s) => s.setCaseModalOpen)
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)

  const lifecycleFilter = searchParams.get('lifecycle')
  const starFilter = searchParams.get('star')
  const recheckFilter = searchParams.get('recheck')
  const disputeTypeFilter = searchParams.get('disputeType')

  const filtered = useMemo(() => {
    let list = [...cases]
    if (lifecycleFilter) {
      list = list.filter((c) => deriveLifecycle(c) === lifecycleFilter)
    }
    if (starFilter === 'true') {
      list = list.filter((c) => c.star)
    }
    if (recheckFilter === 'true') {
      list = list.filter((c) => c.recheck)
    }
    if (disputeTypeFilter) {
      list = list.filter((c) => c.disputeTypeId === disputeTypeFilter)
    }
    return list
  }, [cases, lifecycleFilter, starFilter, recheckFilter, disputeTypeFilter])

  const grouped = useMemo(() => groupCases(filtered, disputeTypes), [filtered, disputeTypes])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  const handleDelete = (id: string) => {
    const rec = cases.find((c) => c.id === id)
    if (!rec) return
    if (!window.confirm(`删除判例 ${formatCaseId(id)}？`)) return
    removeCase(id)
    toast('判例已删除')
  }

  const clearFilter = () => setSearchParams({})

  return (
    <div className="case-list-page">
      <Topbar title="判例库" showDisplay={false} />
      <div className="cl-content">
        {/* Filter chips */}
        <div className="cl-toolbar">
        <div className="cl-filters" aria-label="判例筛选">
          <button
            className={'cl-filter-chip' + (!lifecycleFilter && !starFilter && !recheckFilter && !disputeTypeFilter ? ' is-active' : '')}
            onClick={clearFilter}
          >
            全部<span className="cl-filter-count">{cases.length}</span>
          </button>
          <button
            className={'cl-filter-chip' + (lifecycleFilter === '待验证' ? ' is-active' : '')}
            onClick={() => setSearchParams({ lifecycle: '待验证' })}
          >
            待验证<span className="cl-filter-count">{cases.filter((c) => deriveLifecycle(c) === '待验证').length}</span>
          </button>
          <button
            className={'cl-filter-chip' + (lifecycleFilter === '已裁决' ? ' is-active' : '')}
            onClick={() => setSearchParams({ lifecycle: '已裁决' })}
          >
            已裁决<span className="cl-filter-count">{cases.filter((c) => deriveLifecycle(c) === '已裁决').length}</span>
          </button>
          <button
            className={'cl-filter-chip' + (starFilter === 'true' ? ' is-active' : '')}
            onClick={() => setSearchParams({ star: 'true' })}
          >
            <Star size={12} fill="currentColor" />典型<span className="cl-filter-count">{cases.filter((c) => c.star).length}</span>
          </button>
          <button
            className={'cl-filter-chip' + (recheckFilter === 'true' ? ' is-active' : '')}
            onClick={() => setSearchParams({ recheck: 'true' })}
          >
            复看<span className="cl-filter-count">{cases.filter((c) => c.recheck).length}</span>
          </button>
          {disputeTypes.slice(0, 5).map((dt) => {
            const n = cases.filter((c) => c.disputeTypeId === dt.id).length
            if (n === 0) return null
            return (
              <button
                key={dt.id}
                className={'cl-filter-chip' + (disputeTypeFilter === dt.id ? ' is-active' : '')}
                onClick={() => setSearchParams({ disputeType: dt.id })}
              >
                {dt.name.slice(0, 8)}<span className="cl-filter-count">{n}</span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="cl-create-btn"
          onClick={() => setCaseModalOpen(true)}
        >
          <Plus size={14} />
          <span>新建判例</span>
        </button>
        </div>

        {/* Grouped list */}
        <div className="cl-list">
          {grouped.map((g) => (
            <div key={g.label}>
              <div className="cl-group-row">
                <span className="cl-group-name">{g.label}</span>
                <span className="cl-group-count">{g.items.length}</span>
              </div>
              {g.items.map((rec) => (
                <CaseCard
                  key={rec.id}
                  rec={rec}
                  disputeTypes={disputeTypes}
                  selected={selected.has(rec.id)}
                  onToggle={() => toggleSelect(rec.id)}
                  onDelete={() => handleDelete(rec.id)}
                  onClick={() => setDetailId(rec.id)}
                />
              ))}
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="cl-empty">
              <AlertTriangle size={18} />
              <p>暂无判例记录</p>
              <p className="cl-empty-hint">点击右上角 + 或粘贴截图创建判例</p>
            </div>
          )}
        </div>
      </div>

      {detailId && (
        <CaseDetail
          rec={cases.find((c) => c.id === detailId)!}
          disputeTypes={disputeTypes}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  )
}

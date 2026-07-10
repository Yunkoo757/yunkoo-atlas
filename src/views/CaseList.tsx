import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Topbar } from '@/components/Topbar'
import { useStore } from '@/store/useStore'
import {
  type CaseRecord,
  type DisputeType,
  deriveLifecycle,
  deriveOutcome,
  formatCaseId,
  getCaseNextAction,
  getDisputeType,
  OUTCOME_COLORS,
} from '@/data/case'
import { fmtDate } from '@/lib/format'
import { Star, AlertTriangle, Trash2, Plus, Link2, Camera, Gavel } from 'lucide-react'
import { toast } from '@/lib/toast'
import { CaseDetail } from './CaseDetail'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { buildCaseCtxItems } from '@/lib/caseMenu'
import { CaseCompare } from '@/components/CaseCompare'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
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
  trades,
  strategies,
  selected,
  onToggle,
  onDelete,
  onClick,
  onContextMenu,
  focused,
}: {
  rec: CaseRecord
  disputeTypes: DisputeType[]
  trades: Trade[]
  strategies: Strategy[]
  selected: boolean
  onToggle: () => void
  onDelete: () => void
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  focused: boolean
}) {
  const dt = getDisputeType(rec.disputeTypeId, disputeTypes)
  const outcome = deriveOutcome(rec, dt)
  const colors = OUTCOME_COLORS[outcome]
  const caseId = formatCaseId(rec.id)
  const abbrev = (dt?.name ?? '??').slice(0, 2).toUpperCase()
  const nextAction = getCaseNextAction(rec)
  const sourceTrades = (rec.linkedTradeIds ?? [])
    .map((id) => trades.find((t) => t.id === id))
    .filter(Boolean) as Trade[]
  const source = sourceTrades[0]
  const sourceStrategy = source ? strategies.find((s) => s.id === source.strategyId) : undefined
  const notePreview = getCaseNotePreview(rec.note)

  return (
    <div
      className={'cl-card' + (selected ? ' is-selected' : '') + (focused ? ' is-focused' : '')}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
        <div className="cl-context-row">
          {source ? (
            <span className="cl-source">
              <Link2 size={11} />
              {source.ref} · {source.symbol}
              {sourceStrategy ? ` · ${sourceStrategy.name}` : ''}
            </span>
          ) : (
            <span className="cl-source cl-source-missing">未关联交易</span>
          )}
          <span className={'cl-next cl-next-' + nextAction.tone}>
            {nextAction.label}
          </span>
        </div>
        <div className="cl-meta-row">
          <span className="cl-chip">{rec.confidence}%</span>
          <span className="cl-chip cl-chip-icon"><Camera size={11} />{rec.images.length}</span>
          {rec.tags?.slice(0, 3).map((t) => (
            <span className="cl-chip" key={t}>{t}</span>
          ))}
          {notePreview && (
            <span className="cl-note">{notePreview}</span>
          )}
        </div>
      </div>
      <span className="cl-outcome">
        <span className="cl-dot" style={{ background: colors.dot }} />
        {colors.label}
      </span>
      <span className="cl-date">{fmtDate(rec.updatedAt)}</span>
      <Tooltip content="删除判例" label="删除判例">
        <button
          className="cl-del"
          aria-label="删除判例"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          <Trash2 size={13} />
        </button>
      </Tooltip>
    </div>
  )
}

function getCaseNotePreview(note: string | undefined): string {
  if (!note?.trim()) return ''
  const ignoredPrefixes = ['来源交易', '策略', '交易标签', '错误 / 违规']
  const line = note
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => {
      if (!item) return false
      if (ignoredPrefixes.some((prefix) => item.startsWith(prefix))) return false
      if (item.endsWith('：') || item.endsWith(':')) return false
      return true
    })
  return line ?? ''
}

export function CaseList() {
  const cases = useStore((s) => s.cases).filter((c) => !c.deletedAt)
  const disputeTypes = useStore((s) => s.disputeTypes)
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const removeCase = useStore((s) => s.removeCase)
  const updateCase = useStore((s) => s.updateCase)
  const restoreCase = useStore((s) => s.restoreCase)
  const setCaseModalOpen = useStore((s) => s.setCaseModalOpen)
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [ctx, setCtx] = useState<CtxState | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(-1)

  const lifecycleFilter = searchParams.get('lifecycle')
  const starFilter = searchParams.get('star')
  const recheckFilter = searchParams.get('recheck')
  const disputeTypeFilter = searchParams.get('disputeType')
  const caseParam = searchParams.get('case')

  useEffect(() => {
    if (!caseParam) return
    if (cases.some((c) => c.id === caseParam)) setDetailId(caseParam)
  }, [caseParam, cases])

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
  const detailCase = detailId ? cases.find((c) => c.id === detailId) : null

  // 键盘导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (filtered.length === 0) return
      if (e.key === 'j') { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, filtered.length - 1)) }
      else if (e.key === 'k') { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter' && focusIdx >= 0 && filtered[focusIdx]) {
        e.preventDefault()
        openCase(filtered[focusIdx].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, focusIdx])

  useEffect(() => { setFocusIdx(-1) }, [filtered.length])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  const handleDelete = (id: string) => {
    removeCase(id)
    toast('已移至回收站，30天后自动清空')
  }

  const clearFilter = () => setSearchParams({})

  const openCase = (id: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('case', id)
    setSearchParams(next)
    setDetailId(id)
  }

  const onCaseContext = (e: React.MouseEvent, rec: CaseRecord) => {
    e.preventDefault()
    setCtx({
      x: e.clientX,
      y: e.clientY,
      items: buildCaseCtxItems(rec, disputeTypes, { updateCase, removeCase }),
    })
  }

  const closeDetail = () => {
    setDetailId(null)
    if (!caseParam) return
    const next = new URLSearchParams(searchParams)
    next.delete('case')
    setSearchParams(next, { replace: true })
  }

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
        {selected.size >= 2 && (
          <button
            type="button"
            className="cl-create-btn"
            onClick={() => setCompareOpen(true)}
            style={{ marginLeft: 4 }}
          >
            <Gavel size={14} />
            <span>对比 {selected.size}</span>
          </button>
        )}
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
                  trades={trades}
                  strategies={strategies}
                  selected={selected.has(rec.id)}
                  onToggle={() => toggleSelect(rec.id)}
                  onDelete={() => handleDelete(rec.id)}
                  onClick={() => openCase(rec.id)}
                  onContextMenu={(e) => onCaseContext(e, rec)}
                  focused={rec.id === filtered[focusIdx]?.id}
                />
              ))}
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="cl-empty">
              <AlertTriangle size={18} />
              <p>暂无判例记录</p>
              <p className="cl-empty-hint">从交易详情沉淀争议点，或先创建一条独立判例。</p>
              <button
                type="button"
                className="cl-empty-action"
                onClick={() => setCaseModalOpen(true)}
              >
                <Plus size={14} />
                创建第一条判例
              </button>
            </div>
          )}
        </div>
      </div>

      {detailCase && (
        <CaseDetail
          rec={detailCase}
          disputeTypes={disputeTypes}
          onClose={closeDetail}
        />
      )}
      <ContextMenu state={ctx} onClose={() => setCtx(null)} />
      {compareOpen && (
        <CaseCompare
          cases={cases.filter((c) => selected.has(c.id))}
          disputeTypes={disputeTypes}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  )
}

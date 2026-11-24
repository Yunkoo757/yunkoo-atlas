import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PopoverSurface } from '@/components/ui/PopoverSurface'
import { useExitClone } from '@/components/ui/useExitClone'
import type { RiskPeriodOutcomeSnapshot, RiskPeriodScope } from '@/data/riskManagement'
import { ChevronRight, ChevronUp, Shield } from '@/icons/appIcons'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { fmtR } from '@/lib/format'
import { getCurrentLiveStage } from '@/lib/liveStages'
import { resolveRiskOutcomes } from '@/lib/riskBudget'
import { presentRiskOutcome, type RiskStatusKind, type RiskStatusPresentation } from '@/lib/riskStatus'
import { useStore } from '@/store/useStore'

const PERIODS = [
  { scope: 'day', label: '今日' },
  { scope: 'week', label: '本周' },
  { scope: 'month', label: '本月' },
] as const

export type SidebarRiskRow = {
  scope: RiskPeriodScope
  label: string
  outcome: RiskPeriodOutcomeSnapshot
  presentation: RiskStatusPresentation
}

function formatR(value: number) {
  return fmtR(value).replace(/^\+/, '').replace(/\.0R$/, 'R')
}

function periodStatus(row: SidebarRiskRow) {
  if (row.presentation.kind === 'triggered' && row.outcome.consumedR === row.outcome.limitR) return '已达限额'
  if (row.presentation.kind === 'unconfigured') return '未设置'
  return row.presentation.label
}

// 同等状态保留用户选的周期。其他周期先触线时，入口点明对应的周期。
const PRIORITY: Record<RiskStatusKind, number> = {
  normal: 0, unconfigured: 0, partial: 1, near: 2, unknown: 3, triggered: 4,
}

export function buildSidebarRiskSummary(rows: readonly SidebarRiskRow[], preferred: RiskPeriodScope) {
  const selected = rows.find(row => row.scope === preferred) ?? rows[0]
  if (!selected) return null
  const row = rows.reduce((lead, next) => (
    PRIORITY[next.presentation.kind] > PRIORITY[lead.presentation.kind] ? next : lead
  ), selected)
  const { kind } = row.presentation
  const value = kind === 'normal' || kind === 'near'
    ? `${row.label}余 ${formatR(row.outcome.remainingR)}`
    : row.label + periodStatus(row)
  return { row, value }
}

function SidebarRiskPeriod({ row }: { row: SidebarRiskRow }) {
  const { kind } = row.presentation
  const { coverage, consumedR, limitR } = row.outcome
  const knownUsage = coverage === 'complete' || (coverage === 'partial' && kind === 'triggered')
  return (
    <div className={`sb-risk-period is-${kind}`} data-risk-period={row.scope}>
      <dt>
        <span>{row.label}</span>
        {kind !== 'normal' && kind !== 'unconfigured' && <small>{periodStatus(row)}</small>}
      </dt>
      <dd>
        {limitR > 0 ? <>
          <strong>
            {knownUsage && coverage === 'partial' && '已计 '}
            {knownUsage ? formatR(consumedR).slice(0, -1) : '—'}
          </strong>
          <span>/ {formatR(limitR)}</span>
        </> : <span>{kind === 'unconfigured' ? '未设置' : '—'}</span>}
      </dd>
    </div>
  )
}

function SidebarRiskDisclosure({ rows, scope }: { rows: SidebarRiskRow[]; scope: RiskPeriodScope }) {
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const exitRef = useExitClone(open, panelRef)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.key])

  useLayoutEffect(() => {
    if (!open) return
    panelRef.current?.focus({ preventScroll: true })
    const dismissOutside = (event: Event) => {
      const target = event.target
      if (target instanceof Node && !triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('focusin', dismissOutside)
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('focusin', dismissOutside)
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [open])

  const summary = buildSidebarRiskSummary(rows, scope)
  if (!summary) return null
  const { row, value } = summary
  const needsReview = rows.some(item => item.outcome.coverage !== 'complete')
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`sb-item sb-risk-summary is-${row.presentation.kind}`}
        data-sidebar-risk-state={row.presentation.kind}
        data-risk-scope={row.scope}
        aria-label={row.presentation.kind === 'near' ? `风险额度，${value}，接近限额` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(wasOpen => !wasOpen)}
      >
        <Shield size={ICON_MD} aria-hidden="true" />
        <span>风险额度</span>
        <span className="sb-risk-value">{value}</span>
        <ChevronUp className="sb-risk-chevron" size={ICON_SM} aria-hidden="true" />
      </button>
      {open && (
        <PopoverSurface ref={exitRef} kind="menu" id={panelId} labelledBy={panelId + '-title'}
          className="sb-risk-popover" role="dialog" tabIndex={-1}>
          <header className="sb-risk-popover-head">
            <h2 id={panelId + '-title'}>额度明细</h2>
            <span>已用 / 上限</span>
          </header>
          <dl className="sb-risk-periods">
            {rows.map(item => <SidebarRiskPeriod key={item.scope} row={item} />)}
          </dl>
          <div className="sb-risk-actions">
            {needsReview && <Link to="/settings/risk/data-repair" onClick={() => setOpen(false)}>
              核对风险数据<ChevronRight size={ICON_SM} aria-hidden="true" />
            </Link>}
            <Link className="sb-risk-manage" to="/settings/risk" onClick={() => setOpen(false)}>
              风险规则<ChevronRight size={ICON_SM} aria-hidden="true" />
            </Link>
          </div>
        </PopoverSurface>
      )}
    </>
  )
}

export function SidebarRiskStatus({ currentTradingDayKey }: { currentTradingDayKey: string }) {
  const trades = useStore(state => state.trades)
  const policies = useStore(state => state.riskPolicyVersions)
  const monthlyLimits = useStore(state => state.monthlyRiskLimits)
  const liveStages = useStore(state => state.liveStages)
  const currentLiveStageId = useStore(state => state.currentLiveStageId)
  const tradingDayStartHour = useStore(state => state.display.tradingDayStartHour)
  const sidebarRiskScope = useStore(state => state.display.sidebarRiskScope ?? 'day')
  const currentStage = getCurrentLiveStage(liveStages, currentLiveStageId)

  const rows = useMemo(() => {
    const outcomes = resolveRiskOutcomes({
      trades, policies, monthlyLimits,
      liveStageId: currentStage.id,
      liveStageStartsOn: currentStage.startsOn,
      currentTradingDayKey, tradingDayStartHour,
    })
    return PERIODS.map(period => {
      const outcome = outcomes[period.scope]
      return { ...period, outcome, presentation: presentRiskOutcome(outcome) }
    })
  }, [currentStage.id, currentStage.startsOn, currentTradingDayKey, monthlyLimits, policies, trades, tradingDayStartHour])

  if (rows.every(row => row.presentation.kind === 'unconfigured')) {
    return (
      <Link to="/settings/risk" className="sb-item sb-risk-summary" data-sidebar-risk-state="unconfigured" aria-label="设置风险额度">
        <Shield size={ICON_MD} aria-hidden="true" />
        <span>风险额度</span>
        <span className="sb-risk-value">设置</span>
        <ChevronRight className="sb-risk-chevron" size={ICON_SM} aria-hidden="true" />
      </Link>
    )
  }
  return <SidebarRiskDisclosure rows={rows} scope={sidebarRiskScope} />
}

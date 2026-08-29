import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { RiskPeriodOutcomeSnapshot, RiskPeriodScope } from '@/data/riskManagement'
import { ChevronRight } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import { fmtR } from '@/lib/format'
import { getCurrentLiveStage } from '@/lib/liveStages'
import { resolveRiskOutcomes } from '@/lib/riskBudget'
import { presentRiskOutcome, type RiskStatusKind, type RiskStatusPresentation } from '@/lib/riskStatus'
import { useStore } from '@/store/useStore'
import type { SidebarRiskScope } from '@/lib/tradeFilters'

const PERIODS: ReadonlyArray<{ scope: RiskPeriodScope; shortLabel: string; label: string }> = [
  { scope: 'day', shortLabel: '日', label: '今日' },
  { scope: 'week', shortLabel: '周', label: '本周' },
  { scope: 'month', shortLabel: '月', label: '本月' },
]

export type SidebarRiskRow = {
  scope: RiskPeriodScope
  shortLabel: string
  label: string
  outcome: RiskPeriodOutcomeSnapshot
  presentation: RiskStatusPresentation
}

export type SidebarRiskSummary = {
  kind: RiskStatusKind
  label: string
  value: string
  ariaLabel: string
}

export type SidebarRiskGauge = {
  scope: SidebarRiskScope
  kind: RiskStatusKind
  remainingRatio: number
  ariaLabel: string
}

function formatR(value: number): string {
  return fmtR(Math.abs(value)).replace(/^\+/, '')
}

function periodValue(row: SidebarRiskRow): string {
  const { outcome } = row
  return `${formatR(outcome.consumedR)} / ${outcome.limitR > 0 ? formatR(outcome.limitR) : '—'}`
}

function rowPriority(kind: RiskStatusKind): number {
  if (kind === 'triggered') return 5
  if (kind === 'unknown') return 4
  if (kind === 'unconfigured') return 3
  if (kind === 'near') return 2
  if (kind === 'partial') return 1
  return 0
}

export function buildSidebarRiskSummary(rows: readonly SidebarRiskRow[]): SidebarRiskSummary {
  const lead = [...rows].sort((left, right) => (
    rowPriority(right.presentation.kind) - rowPriority(left.presentation.kind)
  ))[0]
  const day = rows.find((row) => row.scope === 'day')
  if (!lead || !day) {
    return { kind: 'unknown', label: '风险待确认', value: '查看', ariaLabel: '风险状态待确认' }
  }

  const fullStatus = rows.map((row) => (
    `${row.label}${row.presentation.label}，已用 ${periodValue(row)}`
  )).join('；')

  if (lead.presentation.kind === 'triggered') {
    const excess = Math.max(0, lead.outcome.consumedR - lead.outcome.limitR)
    const value = excess > 0 ? `${lead.shortLabel}超 ${formatR(excess)}` : `${lead.shortLabel}已满`
    return { kind: 'triggered', label: '已暂停交易', value, ariaLabel: `${fullStatus}。当前暂停开仓` }
  }
  if (lead.presentation.kind === 'unknown') {
    return { kind: 'unknown', label: '风险待补齐', value: '查看', ariaLabel: fullStatus }
  }
  if (lead.presentation.kind === 'unconfigured') {
    return { kind: 'unconfigured', label: '风险未设置', value: '设置', ariaLabel: fullStatus }
  }
  if (lead.presentation.kind === 'near') {
    return {
      kind: 'near',
      label: `${lead.label}临界`,
      value: `余 ${formatR(lead.outcome.remainingR)}`,
      ariaLabel: fullStatus,
    }
  }
  if (lead.presentation.kind === 'partial') {
    return { kind: 'partial', label: '数据待确认', value: '查看', ariaLabel: fullStatus }
  }
  return {
    kind: 'normal',
    label: '风控中心',
    value: `余 ${formatR(day.outcome.remainingR)}`,
    ariaLabel: fullStatus,
  }
}

export function buildSidebarRiskGauge(
  rows: readonly SidebarRiskRow[],
  scope: SidebarRiskScope,
): SidebarRiskGauge {
  const row = rows.find((item) => item.scope === scope)
  const label = row?.label ?? ({ day: '今日', week: '本周', month: '本月' } as const)[scope]
  if (!row) {
    return {
      scope,
      kind: 'unknown',
      remainingRatio: 0,
      ariaLabel: `${label}风险额度待确认，点击查看日周月风险额度`,
    }
  }
  const ratio = row.outcome.limitR > 0
    ? Math.max(0, Math.min(1, row.outcome.remainingR / row.outcome.limitR))
    : 0
  return {
    scope,
    kind: row.presentation.kind,
    remainingRatio: ratio,
    ariaLabel: `${label}风险额度，剩余 ${formatR(row.outcome.remainingR)}，共 ${row.outcome.limitR > 0 ? formatR(row.outcome.limitR) : '未设置'}，${row.presentation.label}。点击查看日周月风险额度`,
  }
}

function SidebarRiskPeriod({ row }: { row: SidebarRiskRow }) {
  const showStatus = row.presentation.kind !== 'normal'
  const progress = Math.max(0, Math.min(1, row.outcome.progress))
  return (
    <div
      className={`sb-risk-period is-${row.presentation.kind}`}
      data-risk-period={row.scope}
      aria-label={`${row.label}${row.presentation.label}，已用 ${periodValue(row)}`}
    >
      <div className="sb-risk-period-head">
        <span className="sb-risk-period-label">{row.label}</span>
        {showStatus ? <small>{row.presentation.label}</small> : null}
      </div>
      <span
        className="sb-risk-period-track"
        role="progressbar"
        aria-label={`${row.label}风险额度使用进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <i style={{ width: `${progress * 100}%` }} />
      </span>
    </div>
  )
}

export function SidebarRiskStatus({ currentTradingDayKey }: { currentTradingDayKey: string }) {
  const popoverId = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const sidebarRiskScope = useStore((state) => state.display.sidebarRiskScope ?? 'day')
  const currentStage = getCurrentLiveStage(liveStages, currentLiveStageId)

  const rows = useMemo<SidebarRiskRow[]>(() => {
    const outcomes = resolveRiskOutcomes({
      trades,
      policies,
      monthlyLimits,
      liveStageId: currentStage.id,
      liveStageStartsOn: currentStage.startsOn,
      currentTradingDayKey,
      tradingDayStartHour,
    })
    return PERIODS.map((period) => {
      const outcome = outcomes[period.scope]
      return { ...period, outcome, presentation: presentRiskOutcome(outcome) }
    })
  }, [
    currentStage.id,
    currentStage.startsOn,
    currentTradingDayKey,
    monthlyLimits,
    policies,
    trades,
    tradingDayStartHour,
  ])
  const summary = useMemo(() => buildSidebarRiskSummary(rows), [rows])
  const gauge = useMemo(
    () => buildSidebarRiskGauge(rows, sidebarRiskScope),
    [rows, sidebarRiskScope],
  )
  const popoverStatus = summary.kind === 'normal' ? '充足' : summary.label

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect()
    const popover = popoverRef.current?.getBoundingClientRect()
    if (!trigger || !popover) return
    const edge = 8
    const left = Math.min(trigger.right + edge, window.innerWidth - popover.width - edge)
    const top = Math.min(
      Math.max(edge, trigger.bottom - popover.height),
      window.innerHeight - popover.height - edge,
    )
    setPosition({ left: Math.max(edge, left), top })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const frame = requestAnimationFrame(updatePosition)
    return () => cancelAnimationFrame(frame)
  }, [open, updatePosition])

  useEffect(() => {
    if (!open || !position) return
    popoverRef.current?.focus({ preventScroll: true })
  }, [open, position])

  useLayoutEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      close()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [close, open, updatePosition])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`sb-risk-summary is-${gauge.kind}`}
        data-sidebar-risk-state={gauge.kind}
        data-risk-scope={gauge.scope}
        data-risk-progress={gauge.remainingRatio.toFixed(3)}
        aria-label={gauge.ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          if (open) {
            close()
            return
          }
          setPosition(null)
          setOpen(true)
        }}
      >
        <svg className="sb-risk-gauge" viewBox="0 0 20 20" aria-hidden="true">
          <circle className="sb-risk-gauge-core" cx="10" cy="10" r="5.25" />
          <circle className="sb-risk-gauge-track" cx="10" cy="10" r="7.5" pathLength="100" />
          <circle
            className="sb-risk-gauge-progress"
            cx="10"
            cy="10"
            r="7.5"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - (gauge.remainingRatio * 100)}
          />
        </svg>
      </button>
      {open ? createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          className={`sb-risk-popover is-${summary.kind}`}
          role="dialog"
          tabIndex={-1}
          aria-label="风险使用情况"
          style={position ?? { visibility: 'hidden' }}
        >
          <header className="sb-risk-popover-head">
            <strong>风险额度</strong>
            <span>{popoverStatus}</span>
          </header>
          <div className="sb-risk-periods">
            {rows.map((row) => <SidebarRiskPeriod key={row.scope} row={row} />)}
          </div>
          <Link className="sb-risk-manage" to="/settings/risk" onClick={() => close()}>
            <span>风险规则</span>
            <ChevronRight size={ICON_MD} aria-hidden="true" />
          </Link>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

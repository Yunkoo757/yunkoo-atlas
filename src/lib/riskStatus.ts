import type { RiskPeriodOutcomeSnapshot } from '@/data/riskManagement'

export type RiskStatusKind =
  | 'normal'
  | 'near'
  | 'triggered'
  | 'partial'
  | 'unknown'
  | 'unconfigured'

export interface RiskStatusPresentation {
  kind: RiskStatusKind
  label: '正常' | '接近限额' | '已超限' | '待确认' | '无法判断' | '未配置'
}

export interface RiskStatusRow {
  periodLabel: string
  presentation: RiskStatusPresentation
}

export function presentRiskOutcome(outcome: RiskPeriodOutcomeSnapshot): RiskStatusPresentation {
  if (outcome.limitR <= 0) return { kind: 'unconfigured', label: '未配置' }
  if (outcome.coverage === 'unknown') return { kind: 'unknown', label: '无法判断' }
  if (outcome.triggered || outcome.progress >= 1) return { kind: 'triggered', label: '已超限' }
  if (outcome.coverage === 'partial') return { kind: 'partial', label: '待确认' }
  if (outcome.progress >= 0.9) return { kind: 'near', label: '接近限额' }
  return { kind: 'normal', label: '正常' }
}

function issueCopy(row: RiskStatusRow): string | null {
  switch (row.presentation.kind) {
    case 'triggered': return `${row.periodLabel}已超限`
    case 'near': return `${row.periodLabel}接近限额`
    case 'partial': return `${row.periodLabel}数据待确认`
    case 'unknown': return `${row.periodLabel}无法判断`
    case 'unconfigured': return `${row.periodLabel}未配置`
    case 'normal': return null
  }
}

export function summarizeRiskStatus(rows: readonly RiskStatusRow[]): string {
  const issues = rows.map(issueCopy).filter((value): value is string => Boolean(value))
  if (issues.length === 0) return '日、周、月均在风险限额内。'
  const safe = rows
    .filter((row) => row.presentation.kind === 'normal')
    .map((row) => row.periodLabel)
  return `${issues.join('，')}${safe.length > 0 ? `；${safe.join('、')}仍在限额内。` : '。'}`
}

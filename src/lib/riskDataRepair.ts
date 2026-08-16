import type { RiskDataIssue, RiskDataIssueReason, RiskDataIssueSeverity } from '@/data/riskManagement'

export type RiskRepairBucket = 'priority' | 'completeness'
export type RiskRepairActionKind = 'data-settings' | 'open-trade' | 'view-trade'

export interface RiskRepairItem {
  issue: RiskDataIssue
  primaryReason: RiskDataIssueReason
  retained: boolean
  actionKind: RiskRepairActionKind
}

export interface RiskRepairGroup {
  key: string
  bucket: RiskRepairBucket
  reason: RiskDataIssueReason
  retained: boolean
  items: RiskRepairItem[]
}

export interface RiskDataRepairQueue {
  counts: { total: number; global: number; blocking: number; partial: number }
  retainedCount: number
  retainedOnly: boolean
  items: RiskRepairItem[]
  groups: RiskRepairGroup[]
  nextItem: RiskRepairItem | null
}

const SEVERITY_ORDER: Record<RiskDataIssueSeverity, number> = { global: 0, blocking: 1, partial: 2 }
const RETAINED_REASONS = new Set<RiskDataIssueReason>(['missing-policy', 'partial-missing-policy'])

export function isRetainedRiskIssue(issue: RiskDataIssue): boolean {
  return issue.reasons.length > 0 && issue.reasons.every((reason) => RETAINED_REASONS.has(reason))
}

function primaryReason(issue: RiskDataIssue): RiskDataIssueReason {
  const reason = issue.reasons.find((candidate) => !RETAINED_REASONS.has(candidate)) ?? issue.reasons[0]
  if (!reason) throw new Error('风险数据问题必须至少包含一个原因')
  return reason
}

export function buildRiskDataRepairQueue(issues: readonly RiskDataIssue[]): RiskDataRepairQueue {
  const ordered = issues
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => SEVERITY_ORDER[left.issue.severity] - SEVERITY_ORDER[right.issue.severity] || left.index - right.index)
    .map(({ issue }) => {
      const retained = isRetainedRiskIssue(issue)
      return {
        issue,
        retained,
        primaryReason: primaryReason(issue),
        actionKind: issue.severity === 'global' ? 'data-settings' : retained ? 'view-trade' : 'open-trade',
      } satisfies RiskRepairItem
    })

  const groups: RiskRepairGroup[] = []
  for (const item of ordered) {
    const bucket: RiskRepairBucket = item.issue.severity === 'partial' ? 'completeness' : 'priority'
    const key = `${bucket}:${item.primaryReason}`
    let group = groups.find((candidate) => candidate.key === key)
    if (!group) {
      group = { key, bucket, reason: item.primaryReason, retained: item.retained, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }

  const retainedCount = ordered.filter((item) => item.retained).length
  return {
    counts: {
      total: ordered.length,
      global: ordered.filter((item) => item.issue.severity === 'global').length,
      blocking: ordered.filter((item) => item.issue.severity === 'blocking').length,
      partial: ordered.filter((item) => item.issue.severity === 'partial').length,
    },
    retainedCount,
    retainedOnly: ordered.length > 0 && retainedCount === ordered.length,
    items: ordered,
    groups,
    nextItem: ordered.find((item) => !item.retained) ?? null,
  }
}

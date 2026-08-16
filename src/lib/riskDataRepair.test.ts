import type { RiskDataIssue } from '@/data/riskManagement'
import { buildRiskDataRepairQueue } from '@/lib/riskDataRepair'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function issue(input: Partial<RiskDataIssue> & Pick<RiskDataIssue, 'severity' | 'reasons'>): RiskDataIssue {
  return {
    tradeId: input.tradeId ?? null,
    tradeRef: input.tradeRef ?? null,
    tradingDayKey: input.tradingDayKey ?? null,
    severity: input.severity,
    reasons: input.reasons,
  }
}

export function testRepairQueuePrioritizesActionableIssues(): void {
  const queue = buildRiskDataRepairQueue([
    issue({ tradeId: 'retained', tradeRef: 'TRD-1', severity: 'blocking', reasons: ['missing-policy'] }),
    issue({ tradeId: 'partial', tradeRef: 'TRD-2', severity: 'partial', reasons: ['partial-missing-pnl'] }),
    issue({ tradeId: 'blocking', tradeRef: 'TRD-3', severity: 'blocking', reasons: ['missing-loss-pnl'] }),
    issue({ severity: 'global', reasons: ['invalid-live-cycle-start'] }),
  ])

  assert(queue.nextItem?.issue.severity === 'global', '全局问题必须成为下一项')
  assert(queue.items.map((item) => item.issue.tradeId).join(',') === ',retained,blocking,partial', '必须按全局、阻断、完整度并保持同级输入顺序')
  assert(queue.retainedCount === 1, '必须独立统计保留型历史缺口')
}

export function testRepairQueueSkipsRetainedHistoryAndGroupsOnce(): void {
  const queue = buildRiskDataRepairQueue([
    issue({ tradeId: 'history', tradeRef: 'TRD-4', severity: 'blocking', reasons: ['missing-policy'] }),
    issue({ tradeId: 'mixed', tradeRef: 'TRD-5', severity: 'blocking', reasons: ['missing-policy', 'missing-close-date'] }),
  ])

  assert(queue.nextItem?.issue.tradeId === 'mixed', '纯历史缺口不得占用下一项')
  assert(queue.groups.flatMap((group) => group.items).filter((item) => item.issue.tradeId === 'mixed').length === 1, '多原因交易只能进入一个主分组')
  assert(queue.groups.find((group) => group.items.some((item) => item.issue.tradeId === 'mixed'))?.reason === 'missing-close-date', '主分组必须选择第一个可修复原因')
}

export function testRepairQueueRetainedOnlyKeepsGroupsWithoutNextAction(): void {
  const queue = buildRiskDataRepairQueue([
    issue({ tradeId: 'history', tradeRef: 'TRD-6', severity: 'blocking', reasons: ['missing-policy'] }),
  ])

  assert(queue.retainedOnly, '纯历史缺口必须标记为 retainedOnly')
  assert(queue.groups.length === 1 && queue.groups[0]?.retained, '纯历史缺口必须保留在历史原因分组中')
  assert(queue.nextItem === null, '纯历史缺口不得生成处理下一项动作')
}

export function testRepairQueueCountsGlobalBlockingAndPartialSeparately(): void {
  const queue = buildRiskDataRepairQueue([
    issue({ severity: 'global', reasons: ['invalid-live-cycle-start'] }),
    issue({ tradeId: 'loss', severity: 'blocking', reasons: ['result-conflict'] }),
    issue({ tradeId: 'win', severity: 'partial', reasons: ['partial-missing-pnl'] }),
  ])

  assert(queue.counts.total === 3, '总数必须包含全部问题')
  assert(queue.counts.global === 1, '全局问题必须独立计数')
  assert(queue.counts.blocking === 1, '阻断计数不得重复包含全局问题')
  assert(queue.counts.partial === 1, '完整度计数必须只包含 partial')
}

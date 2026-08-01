import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { RiskPeriodOutcomeSnapshot, WeeklyRiskReviewSnapshot } from '@/data/riskManagement'
import { WeeklyRiskEvidence } from '@/views/WeeklyRiskEvidence'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const complete: RiskPeriodOutcomeSnapshot = {
  netBudgetR: -1,
  limitR: 5,
  consumedR: 1,
  remainingR: 4,
  progress: 0.2,
  coverage: 'complete',
  triggered: false,
  includedTradeCount: 1,
  excludedTradeCount: 0,
  unknownReasons: [],
}

const snapshot: WeeklyRiskReviewSnapshot = {
  frozenAt: '2026-08-01T12:00:00.000Z',
  policyVersions: [{
    id: 'policy-1', sourceWeekStart: '2026-07-27', effectiveTradingDay: '2026-07-27',
    capitalBase: 10_000, riskPercent: 1, riskAmount: 100,
    dailyLossLimitR: 2, weeklyLossLimitR: 5, monthlyLossLimitRDefault: 10,
    disciplineText: '触线后停止开仓', confirmedAt: '2026-07-27T07:00:00.000Z',
  }],
  dailyOutcomes: [
    { ...complete, date: '2026-07-27' },
    { ...complete, netBudgetR: -2, consumedR: 2, remainingR: 3, progress: 0.4, date: '2026-07-28' },
  ],
  weeklyOutcome: complete,
  monthlyOutcomeAtCompletion: { ...complete, limitR: 10, remainingR: 9, progress: 0.1 },
  overrideEvents: [{
    id: 'override-1', tradeId: 'trade-1',
    tradeIdentityAtDecision: { ref: 'TRD-1', symbol: 'BTCUSDT', tradeKind: 'live' },
    linkState: 'resolved', decisionType: 'triggered', tradingDayKeyAtDecision: '2026-07-28',
    policyVersionId: 'policy-1', createdAt: '2026-07-28T10:00:00.000Z',
    reason: '只执行预设止损', fingerprint: 'fixture',
    outcomesAtDecision: { day: complete, week: complete, month: complete }, unknownReasons: [],
  }],
}

export function testWeeklyRiskEvidenceUsesDecisionFirstStructure(): void {
  const html = renderToStaticMarkup(
    <MemoryRouter><WeeklyRiskEvidence snapshot={snapshot} /></MemoryRouter>,
  )
  const weekly = html.indexOf('本周风险状态')
  const monthly = html.indexOf('完成时月度状态')
  const daily = html.indexOf('每日风险轨迹')
  const audit = html.indexOf('冻结审计')
  assert(weekly >= 0 && weekly < monthly && monthly < daily && daily < audit, '信息优先级错误')
  assert((html.match(/class="wr-risk-day"/g) ?? []).length === snapshot.dailyOutcomes.length, '每日行必须一日一行')
  assert(html.includes('<details class="wr-risk-audit"'), '规则和确认必须使用原生 details')
  assert(!html.includes('<details class="wr-risk-audit" open=""'), '审计层默认必须收起')
  assert(!html.includes('wr-metric-grid'), '风控区不得继续使用等权指标网格')
}

export function testWeeklyRiskEvidenceExplainsEmptyConfirmationAudit(): void {
  const html = renderToStaticMarkup(
    <MemoryRouter><WeeklyRiskEvidence snapshot={{ ...snapshot, overrideEvents: [] }} /></MemoryRouter>,
  )
  assert(html.includes('展开后无继续交易确认'), '零确认的审计展开区必须说明为空')
}

export function testWeeklyRiskDailyUsesNetBudgetAndExplainsIncompleteCoverage(): void {
  const dailyOutcomes: WeeklyRiskReviewSnapshot['dailyOutcomes'] = [
    {
      ...complete,
      date: '2026-07-27',
      netBudgetR: 1.25,
      remainingR: 8.75,
      unknownReasons: ['missing-policy'],
    },
    {
      ...complete,
      date: '2026-07-28',
      netBudgetR: -1.5,
      remainingR: 3.5,
      coverage: 'partial',
      unknownReasons: ['missing-loss-pnl'],
    },
    {
      ...complete,
      date: '2026-07-29',
      netBudgetR: -2.25,
      remainingR: 2.75,
      coverage: 'unknown',
      unknownReasons: ['future-loss-close-date', 'invalid-live-cycle-start'],
    },
  ]
  const html = renderToStaticMarkup(
    <MemoryRouter><WeeklyRiskEvidence snapshot={{ ...snapshot, dailyOutcomes }} /></MemoryRouter>,
  )

  assert(html.includes('<strong>+1.25R</strong>'), '每日主数值必须展示净预算 R')
  assert(html.includes('<strong>-1.5R</strong>'), '负净预算 R 必须原样展示')
  assert(!html.includes('8.75R 剩余') && !html.includes('3.5R 剩余'), '每日主数值不得误用 remainingR')
  assert((html.match(/class="wr-risk-day-reasons"/g) ?? []).length === 2, '仅 partial/unknown 应展示原因摘要')
  assert(!html.includes('历史亏损缺少适用规则'), 'complete 行不得展示 unknownReasons')
  assert(html.includes('原因：亏损交易缺少金额'), 'partial 行必须展示共享中文原因')
  assert(html.includes('亏损平仓日期晚于当前交易日、风险核算起点晚于当前交易日'), 'unknown 行必须完整展示多个原因')
  const dailyMarkup = html.slice(html.indexOf('class="wr-risk-daily"'), html.indexOf('class="wr-risk-audits"'))
  assert(!dailyMarkup.includes('已使用 /'), '每日轨迹不得重复已使用/限制文案')
}

import assert from 'node:assert/strict'
import type { Trade } from '@/data/trades'
import { getProjectTrades, summarizeBacktest, summarizeBacktestProjects } from '@/lib/backtestProjects'
import { resolveTradeTruth, summarizeTradeResults } from '@/lib/tradeTruth'

function record(id: string, project = 'one', patch: Partial<Trade> = {}): Trade {
  return {
    id, ref: `TRD-${id}`, tradeKind: 'backtest', backtestProjectId: project,
    symbol: 'XAUUSD', side: 'long', status: 'win', conviction: 'medium',
    strategyId: 'uncategorized', tags: [], mistakeTags: [], reviewStatus: 'unreviewed',
    reviewCategory: 'normal', entry: 0, exit: null, size: 0, pnl: null,
    rMultiple: 2, resultSource: 'r', openedAt: '2025-03-02', closedAt: '2025-03-02',
    note: '', ...patch,
  } as Trade
}

function previousSummary(trades: readonly Trade[]) {
  const summary = summarizeTradeResults([...trades])
  const completed = trades.filter(trade => resolveTradeTruth(trade).isResultComplete)
  const validR = completed.filter(trade => typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple))
  return {
    ...summary, recordedCount: trades.length,
    pendingCount: trades.filter(trade => resolveTradeTruth(trade).executionState !== 'missed' && !resolveTradeTruth(trade).isResultComplete).length,
    observationCount: trades.filter(trade => trade.status === 'missed').length,
    totalR: validR.reduce((sum, trade) => sum + trade.rMultiple!, 0),
    firstDate: trades[0]?.openedAt.slice(0, 10) ?? null,
    lastDate: trades.at(-1)?.openedAt.slice(0, 10) ?? null,
  }
}

export function testBacktestSinglePassSummaryPreservesEveryOutcomeAndMissingMetric(): void {
  const samples = [
    record('1', 'one', { rMultiple: 0.1 }),
    record('2', 'one', { rMultiple: 0.2 }),
    record('3', 'one', { status: 'loss', rMultiple: -1 }),
    record('4', 'one', { status: 'breakeven', rMultiple: -0.02 }),
    record('5', 'one', { status: 'planned', rMultiple: null, resultSource: undefined }),
    record('6', 'one', { status: 'open', rMultiple: null, resultSource: undefined }),
    record('7', 'one', { status: 'missed', rMultiple: null, resultSource: undefined }),
    record('8', 'one', { rMultiple: null, resultSource: undefined }),
    record('9', 'one', { rMultiple: -2 }),
    record('10', 'one', { pnl: 3, rMultiple: -1, resultSource: 'imported' }),
    record('11', 'one', { rMultiple: Number.NaN }),
    record('12', 'one', { rMultiple: Number.POSITIVE_INFINITY }),
  ]
  for (const rows of [[], samples, [...samples].reverse()]) {
    assert.deepEqual(summarizeBacktest(rows), previousSummary(rows), '不能改变已确认/待确认/未参与、冲突、缺失值、保本实际R及首尾日期口径')
  }
}

export function testProjectOverviewGroupsOnlyActiveMembersAndKeepsHistoricalNumericOrder(): void {
  const rows = [
    record('10'), record('2'), record('00', 'one', { openedAt: '2025-03-01', rMultiple: 1e16 }),
    record('last', 'one', { openedAt: '2025-03-03', status: 'loss', rMultiple: -1e16 }),
    record('003'), record('3'), record('other', 'two', { status: 'loss', rMultiple: -2 }),
    record('deleted', 'one', { deletedAt: '2026-01-01' }),
    record('case', 'one', { tradeKind: 'case' }),
    record('paper', 'one', { tradeKind: 'paper' }),
    record('live', 'one', { tradeKind: 'live' }),
  ]
  const before = rows.map(row => ({ ...row }))
  const summaries = summarizeBacktestProjects(rows)
  assert.deepEqual([...summaries.keys()].sort(), ['one', 'two'])
  for (const projectId of ['one', 'two']) {
    const oldRows = rows.filter(trade => trade.tradeKind === 'backtest' && trade.backtestProjectId === projectId && !trade.deletedAt)
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.ref.localeCompare(b.ref, undefined, { numeric: true }))
    assert.deepEqual(getProjectTrades(rows, projectId), oldRows, '项目内日期、数字编号和等价编号稳定次序必须保留')
    assert.deepEqual(summaries.get(projectId), previousSummary(oldRows), '总览与项目详情统计必须逐字段相同，包括浮点求和顺序')
  }
  assert.equal(summaries.has('absent'), false)
  assert.deepEqual([...summarizeBacktestProjects(rows, ['two']).keys()], ['two'], '只汇总当前可见项目，不为已隐藏的大项目排序')
  assert.equal(summarizeBacktestProjects(rows, []).size, 0)
  assert.deepEqual(summarizeBacktest([]), previousSummary([]))
  assert.deepEqual(rows, before, '分组、排序和汇总不能改变store中的源数组或记录')
}

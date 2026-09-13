import type { Trade } from '@/data/trades'
import { findDateSearchTrades, parseCommandDateQuery } from './commandDateSearch'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

export function testCalendarQueriesRespectYearMonthLeapDaysAndPartialInput(): void {
  for (const [input, start, end] of [
    ['2024', '2024-01-01', '2024-12-31'],
    ['202405', '2024-05-01', '2024-05-31'],
    ['2024-05', '2024-05-01', '2024-05-31'],
    ['202402', '2024-02-01', '2024-02-29'],
    ['210002', '2100-02-01', '2100-02-28'],
    ['20000229', '2000-02-29', '2000-02-29'],
    ['20240518', '2024-05-18', '2024-05-18'],
    ['2024-05-18', '2024-05-18', '2024-05-18'],
  ]) {
    const result = parseCommandDateQuery(input!)
    assert(result.kind === 'date' && result.start === start && result.end === end, `范围错误：${input}`)
  }
  for (const input of ['20240', '2024051', '2024-', '2024-0', '2024-05-', '2024-05-1']) {
    assert(parseCommandDateQuery(input).kind === 'incomplete', `应提示继续输入：${input}`)
  }
  for (const input of ['0000', '202400', '202413', '20240230', '20230229', '2024-04-31', '20240500']) {
    assert(parseCommandDateQuery(input).kind === 'invalid', `应拒绝不存在日期：${input}`)
  }
  for (const input of ['', 'GBPUSD', 'TRD-202405', '导航1', '123', 'BTC2024']) {
    assert(parseCommandDateQuery(input).kind === 'text', `不能劫持普通搜索：${input}`)
  }
}

function record(id: string, openedAt: string, kind: Trade['tradeKind'] = 'live'): Trade {
  return {
    id, ref: `TRD-${id}`, symbol: 'GBPUSD', strategyId: 'strategy', tags: ['回调'], mistakeTags: [],
    side: 'long', status: 'win', conviction: 'medium', reviewStatus: 'unreviewed', reviewCategory: 'normal',
    entry: 1, exit: 2, size: 1, pnl: 1, rMultiple: 1, openedAt, closedAt: '2026-09-13', note: '',
    tradeKind: kind, recordedAt: '2026-09-13',
  }
}

export function testDateSearchCoversEveryRecordKindAndMatchesSavedCalendarDate(): void {
  const trades = [
    record('a', '2024-05-01T00:15:00+14:00'),
    record('b', '2024-05-31T23:45:00-12:00', 'paper'),
    { ...record('c', '2024-05-18', 'case'), liveStageId: 'archived-stage', sourceTradeId: 'a' },
    { ...record('d', '2024-05-18'), deletedAt: '2026-09-13' },
    record('e', '2024-06-01'), record('f', '2024-04-30'), record('g', '2024-05-99'),
  ]
  const query = parseCommandDateQuery('202405')
  assert(query.kind === 'date', '缺少范围')
  const result = findDateSearchTrades(trades, query, new Map())
  assert(result.map((trade) => trade.id).join(',') === 'b,c,a', '须包含三种来源和历史阶段，排除删除与无效日期，并按保存日期倒序')
  assert(trades[0]?.id === 'a', '不得修改输入数组顺序')
  assert(result.length === 3, '不得将来源交易与案例合并，或按收录/平仓日期筛选')
}

export function testDateQueryCombinesKeywordsAndKeepsAllMatchesBeyondOneBatch(): void {
  const trades = Array.from({ length: 137 }, (_, i) => record(String(i).padStart(3, '0'), '2024-05-18', i % 2 ? 'case' : 'live'))
  for (const input of ['202405 gbpusd 回调', 'GBPUSD 2024-05 回调', '202405 结构']) {
    const query = parseCommandDateQuery(input)
    assert(query.kind === 'date', '必须拆分日期与关键词')
    assert(findDateSearchTrades(trades, query, new Map([['strategy', '结构']])).length === 137, '完整结果不能被 60 项显示批次截断')
  }
  const query = parseCommandDateQuery('202405 EURUSD')
  assert(query.kind === 'date' && findDateSearchTrades(trades, query, new Map()).length === 0, '关键词必须与日期同时匹配')
}

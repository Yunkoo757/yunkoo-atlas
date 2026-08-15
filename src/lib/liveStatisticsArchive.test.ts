import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import {
  buildLiveArchiveProjection,
  buildLiveArchiveSummary,
  filterAssociatedLiveArchiveCases,
  filterLiveLogRecords,
  filterLivePerformanceRecords,
  listLiveArchiveProjections,
  resolveLiveArchiveScope,
  resolveLiveRecordBucket,
} from '@/lib/liveStatisticsArchive'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function cycle(id: string, startTradingDayKey: string): LivePerformanceCycle {
  return { id, name: `周期 ${id}`, startTradingDayKey, createdAt: '2026-01-01T00:00:00.000Z' }
}

function trade(id: string, patch: Partial<Trade> = {}): Trade {
  return {
    id, ref: `TRD-${id}`, symbol: 'BTCUSD', side: 'long', status: 'win', conviction: 'medium',
    strategyId: 'strategy-1', tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal',
    tradeKind: 'live', entry: 1, exit: 2, size: 1, pnl: 1, rMultiple: null, resultSource: 'pnl',
    openedAt: '2026-01-01', closedAt: '2026-01-01', note: '',
    ...patch,
  }
}

function ids(records: readonly Trade[]): string {
  return records.map((record) => record.id).join(',')
}

const cycles = [
  cycle('one', '2026-01-10'),
  cycle('two', '2026-02-10'),
  cycle('three', '2026-03-10'),
]

export function testArchiveScopeResolvesCurrentArchivesPendingAndUnknownRequests(): void {
  const current = resolveLiveArchiveScope(cycles, null)
  const archive = resolveLiveArchiveScope(cycles, 'one')
  const pending = resolveLiveArchiveScope(cycles, 'pending')
  const unknown = resolveLiveArchiveScope(cycles, 'gone')
  assert(current.kind === 'current' && current.archiveId === 'three', '缺省 scope 必须是最新当前周期')
  assert(archive.kind === 'archive' && archive.bounds?.startInclusive === '2026-01-10' && archive.bounds?.endExclusive === '2026-02-10', '历史周期必须保留左闭右开边界')
  assert(pending.kind === 'pending' && pending.archiveId === null, 'pending 必须是独立 scope')
  assert(unknown.kind === 'all-archives' && unknown.missingRequestedKey === 'gone', '未知 ID 必须降级为全部归档并保留请求值')
  assert(unknown.bounds?.startInclusive === '2026-03-10', '全部归档必须保留当前边界以排除当前记录')
}

export function testRecordBucketsUseReliableCloseDayAndKeepNonPerformanceRecordsOutOfKpi(): void {
  const records = [
    trade('before', { closedTradingDayKey: '2026-01-09' }),
    trade('on-first', { closedTradingDayKey: '2026-01-10' }),
    trade('on-second', { closedTradingDayKey: '2026-02-10' }),
    trade('on-third', { closedTradingDayKey: '2026-03-10' }),
    trade('frozen-wins', { openedAt: '2026-03-15', closedAt: '2026-01-09', closedTradingDayKey: '2026-03-15' }),
    trade('legacy', { openedAt: '2020-01-01', closedAt: '2026-02-12T01:00:00.000Z', closedTradingDayKey: undefined }),
    trade('bad-date', { closedAt: null }),
    trade('planned', { status: 'planned', pnl: null, resultSource: undefined, closedAt: null }),
    trade('open', { status: 'open', pnl: null, resultSource: undefined, closedAt: null }),
    trade('missed', { status: 'missed', pnl: null, resultSource: undefined, closedTradingDayKey: '2026-02-11' }),
    trade('missed-no-day', { status: 'missed', pnl: null, resultSource: undefined, closedAt: null }),
    trade('result-conflict', { closedTradingDayKey: '2026-02-12', pnl: 1, rMultiple: -1, resultSource: 'imported' }),
    trade('result-missing', { closedTradingDayKey: '2026-02-13', pnl: null, rMultiple: null, resultSource: undefined }),
    trade('case', { tradeKind: 'case', sourceTradeId: 'on-second' }),
    trade('deleted', { deletedAt: '2026-02-11T00:00:00.000Z' }),
  ]
  assert(resolveLiveRecordBucket(records[1]!, cycles, 0) === 'archive', '边界日必须归入对应历史周期')
  assert(resolveLiveRecordBucket(records[2]!, cycles, 0) === 'archive', '下一边界日必须归入下一历史周期')
  assert(resolveLiveRecordBucket(records[3]!, cycles, 0) === 'current', '最新边界日必须归当前')
  assert(resolveLiveRecordBucket(records[4]!, cycles, 0) === 'current', '冻结平仓业务日必须优先于 openedAt 与 closedAt')
  assert(resolveLiveRecordBucket(records[5]!, cycles, 0) === 'archive', '旧记录只可由合法 closedAt 补算业务日')
  assert(resolveLiveRecordBucket(records[6]!, cycles, 0) === 'pending', '已平仓但缺可靠日期必须待整理')
  assert(resolveLiveRecordBucket(records[7]!, cycles, 0) === 'archive', '重置前开仓的计划中必须进入历史')
  assert(resolveLiveRecordBucket(records[8]!, cycles, 0) === 'archive', '重置前开仓的持仓必须进入历史')
  assert(
    resolveLiveRecordBucket(trade('open-current', { status: 'open', openedAt: '2026-03-12', pnl: null, resultSource: undefined, closedAt: null }), cycles, 0) === 'current',
    '当前边界后开仓的持仓必须留在当前',
  )
  assert(resolveLiveRecordBucket(records[9]!, cycles, 0) === 'archive' && resolveLiveRecordBucket(records[10]!, cycles, 0) === 'pending', '错过机会按可靠日期归属，缺日期待整理')
  assert(resolveLiveRecordBucket(records[13]!, cycles, 0) === 'excluded' && resolveLiveRecordBucket(records[14]!, cycles, 0) === 'excluded', '案例与软删除记录必须排除')
  assert(ids(filterLiveLogRecords(records, resolveLiveArchiveScope(cycles, 'two'), 0)) === 'on-second,legacy,missed,result-conflict,result-missing', '日志必须包含对应周期的已平仓、错过和待展示记录')
  assert(ids(filterLivePerformanceRecords(records, resolveLiveArchiveScope(cycles, 'two'), 0)) === 'on-second,legacy', '绩效必须排除结果冲突和缺结果的已平仓实盘')
  assert(ids(filterLiveLogRecords(records, resolveLiveArchiveScope(cycles, 'gone'), 0)) === 'before,on-first,on-second,legacy,planned,open,missed,result-conflict,result-missing', '全部归档必须包含当前边界前的可靠历史记录与重置前进行中')
}

export function testArchiveSummarySharesAttributionAndSeparatesResultCompleteness(): void {
  const scopedTrades = [
    trade('valid', { closedTradingDayKey: '2026-02-10' }),
    trade('conflict', { closedTradingDayKey: '2026-02-11', pnl: 1, rMultiple: -1, resultSource: 'imported' }),
    trade('missing-result', { closedTradingDayKey: '2026-02-12', pnl: null, rMultiple: null, resultSource: undefined }),
    trade('missed-in-scope', { status: 'missed', pnl: null, resultSource: undefined, closedTradingDayKey: '2026-02-13' }),
    trade('missing-close-day', { closedAt: null }),
    trade('outside', { closedTradingDayKey: '2026-03-10' }),
  ]
  const cases = [
    trade('case-valid', { tradeKind: 'case', sourceTradeId: 'valid' }),
    trade('case-conflict', { tradeKind: 'case', sourceTradeId: 'conflict' }),
    trade('case-missing', { tradeKind: 'case', sourceTradeId: 'missing-result' }),
    trade('case-missed', { tradeKind: 'case', sourceTradeId: 'missed-in-scope' }),
    trade('case-outside', { tradeKind: 'case', sourceTradeId: 'outside' }),
    trade('case-unlinked', { tradeKind: 'case' }),
    trade('case-deleted', { tradeKind: 'case', sourceTradeId: 'valid', deletedAt: '' }),
  ]
  const summary = buildLiveArchiveSummary(scopedTrades, cases, cycles[1]!, cycles, 0)
  assert(ids(summary.trades) === 'valid', '绩效列表与 KPI 必须只消费结果完整的归档交易')
  assert(summary.startTradingDayKey === '2026-02-10' && summary.endExclusiveTradingDayKey === '2026-03-10', '摘要必须暴露归档边界')
  assert(summary.resultCompleteness.closedCount === 3 && summary.resultCompleteness.validResultCount === 1, '完整度必须按归属后的已平仓实盘计算')
  assert(summary.resultCompleteness.conflictCount === 1 && summary.resultCompleteness.missingResultCount === 1, '结果冲突与缺结果必须独立计算')
  assert(summary.resultCompleteness.missingCloseDayCount === 0, '单归档不得重复计入无法归属的全局待整理平仓日')
  assert(summary.associatedCaseCount === 4, '案例必须按 sourceTradeId 关联同周期日志成员，包括错过、冲突与缺结果记录')

  const projection = buildLiveArchiveProjection(scopedTrades, cases, cycles[1]!, cycles, 0)
  assert(projection.members.length === 4, '归档投影必须一次生成详情日志成员')
  assert(ids(projection.summary.trades) === 'valid', '同一投影必须派生 KPI，不能再次扫描全量交易构造详情范围')
  assert(
    JSON.stringify(projection.summary) === JSON.stringify(buildLiveArchiveSummary(scopedTrades, cases, cycles[1]!, cycles, 0, projection.members)),
    '预计算成员传给摘要后必须保持与单次归档投影相同的统计结果',
  )
}

export function testNoCycleBoundaryTreatsAllHistoryAsCurrent(): void {
  const historical = trade('historical', { openedAt: '2020-01-01', closedAt: '2020-01-02' })
  assert(resolveLiveArchiveScope([], null).kind === 'current', '无边界时缺省 scope 仍是当前')
  assert(resolveLiveRecordBucket(historical, [], 0) === 'current', '无边界时全部历史实盘都属于当前')
}

export function testAssociatedCasesOnlyFollowArchivedLiveSources(): void {
  const archived = [
    trade('archived-source'),
    trade('archived-missed', { status: 'missed' }),
  ]
  const candidates = [
    trade('linked', {
      tradeKind: 'case',
      sourceTradeId: 'archived-source',
      caseType: 'exemplar',
    }),
    trade('linked-missed', {
      tradeKind: 'case',
      sourceTradeId: 'archived-missed',
      caseType: 'missed',
    }),
    trade('current-source-case', { tradeKind: 'case', sourceTradeId: 'current-source' }),
    trade('unlinked', { tradeKind: 'case', sourceTradeId: undefined }),
    trade('deleted-case', {
      tradeKind: 'case',
      sourceTradeId: 'archived-source',
      deletedAt: '2026-01-02',
    }),
    trade('not-a-case', { sourceTradeId: 'archived-source' }),
  ]

  assert(
    ids(filterAssociatedLiveArchiveCases(candidates, archived)) === 'linked,linked-missed',
    '历史实盘案例只能按未删除案例的 sourceTradeId 投影',
  )
}

export function testArchiveProjectionsKeepPreBoundaryHistoryWithOneCycle(): void {
  const oneCycle = [cycle('only', '2026-01-10')]
  const before = trade('before-boundary', { closedTradingDayKey: '2026-01-09' })
  const projections = listLiveArchiveProjections([before], [], oneCycle, 0)
  assert(projections.length === 1, '单边界前的历史记录必须生成一个归档投影')
  assert(projections[0]!.summary.archiveId === 'pre-cycle', '最早边界前投影必须使用稳定 ID')
  assert(ids(projections[0]!.members) === 'before-boundary', '最早边界前投影必须包含旧交易')
  assert(resolveLiveArchiveScope(oneCycle, 'pre-cycle').bounds?.endExclusive === '2026-01-10', '最早边界前范围必须截止于第一条边界')
  assert(listLiveArchiveProjections([], [], oneCycle, 0).length === 0, '没有最早边界前成员时不得生成空归档投影')
}

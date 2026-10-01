import { prepareTradeClose } from '@/lib/tradeClose'
import { listPendingStageOwnership } from '@/lib/stageOwnershipRepair'
import { buildReviewPoolCandidateIndex } from '@/lib/reviewPools'
import type { Trade } from '@/data/trades'
import { getProjectTrades, summarizeBacktest, isBacktestProject, backtestProjectIdForPath, type BacktestProject } from '@/lib/backtestProjects'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import { SCHEMA_VERSION } from '@/storage/types'
import { useStore } from '@/store/useStore'
import { filterStageCases } from '@/lib/stageArchive'
import { mergeImportPayload } from '@/lib/importMerge'
import { getDetailNavigation } from '@/shortcuts/listNav'
import { isAccountTrade } from '@/lib/tradeKind'
import { buildBacktestAnalysisPackage } from '@/lib/backtestExport'
import JSZip from 'jszip'
import { copyTradeRecord } from '@/lib/tradeCopyAction'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const project: BacktestProject = { id: 'bt', name: '固定规则100笔', symbol: 'XAUUSD', startedAt: '2025-02-26', targetCount: 100, defaultStrategyId: null, rules: '连续参与', archivedAt: null, completedAt: null, createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' }
function record(index: number, r = 2): Trade {
  return { id: `bt-${index}`, ref: `TRD-${index}`, tradeKind: 'backtest', backtestProjectId: project.id, symbol: 'XAUUSD', side: 'long', status: r > 0 ? 'win' : r < 0 ? 'loss' : 'breakeven', conviction: 'medium', strategyId: 'uncategorized', tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal', entry: 0, exit: null, size: 0, pnl: null, rMultiple: r, resultSource: 'r', openedAt: '2025-03-01', closedAt: '2025-03-01', note: '<p>隔离样例</p>' }
}
function snapshot() { return { ...createEmptyPersistedSnapshot(), backtestProjects: [{ ...project }], trades: [record(1)] } }

export function testBacktestCountsResultsWithoutCalendarLimitOrAccountLeak(): void {
  const trades = Array.from({ length: 100 }, (_, index) => record(index + 1, index < 50 ? 2 : index < 90 ? -1 : 0))
  trades.push({ ...record(101), status: 'planned', rMultiple: null }, { ...record(102), status: 'missed', rMultiple: null }, { ...record(103), status: 'win', rMultiple: null })
  const stats = summarizeBacktest(trades)
  assert(stats.evaluatedCount === 100 && stats.winCount === 50 && stats.lossCount === 40 && stats.breakevenCount === 10, '目标只计已确认结果')
  assert(stats.winRate === 50 && stats.totalR === 60 && stats.averageR === .6 && stats.rCount === 100, '含保本的胜率与R必须一致')
  assert(stats.pendingCount === 2 && stats.observationCount === 1, '未知结果和未参与必须分别计数')
  assert(!trades.some(isAccountTrade), '回测不得参与账号统计')
  assert(isBacktestProject({ ...project, targetCount: 150 }) && !isBacktestProject({ ...project, startedAt: '2025-02-30' }), '目标可调整，错误日期必须拒绝')
}

export function testBacktestSnapshotRoundTripAndOwnershipGuards(): void {
  const roundTrip = decodeCanonicalSnapshot(JSON.parse(JSON.stringify(snapshot())), { version: SCHEMA_VERSION })
  assert(roundTrip.backtestProjects[0]?.rules === project.rules && roundTrip.trades[0]?.backtestProjectId === project.id, '项目与成员必须完整往返')
  for (const broken of [{ ...snapshot(), backtestProjects: [] }, { ...snapshot(), trades: [{ ...record(1), liveStageId: 'wrong' }] }, { ...snapshot(), trades: [{ ...record(1), symbol: 'BTCUSDT' }] }]) {
    let rejected = false
    try { decodeCanonicalSnapshot(broken, { version: SCHEMA_VERSION }) } catch { rejected = true }
    assert(rejected, '非法归属必须拒绝，而不是丢失项目或改为实盘')
  }
  const legacy = decodeCanonicalSnapshot(createEmptyPersistedSnapshot(), { version: 14 })
  assert(legacy.backtestProjects.length === 0, '旧资料库应补齐空项目')
}

export function testBacktestCaseIsIndependentAndDoesNotChangeProjectCount(): void {
  const original = useStore.getState()
  try {
    useStore.setState(snapshot())
    const result = useStore.getState().createReviewCaseFromTrade('bt-1')
    assert(result.status === 'created' && result.reviewCase.tradeKind === 'case', '应能沉淀案例')
    assert(result.reviewCase.liveStageId === null && result.reviewCase.backtestProjectId === 'bt', '回测案例不属于实盘阶段')
    assert(result.reviewCase.sourceNoteHtml === '<p>隔离样例</p>' && result.reviewCase.note === '', '来源快照与案例正文独立')
    assert(getProjectTrades(useStore.getState().trades, 'bt').length === 1, '案例不增减项目笔数')
    assert(filterStageCases(useStore.getState().trades, { kind: 'current', stageId: 'a-new-stage' }).length === 1, '切换阶段后案例仍可用')
    assert(listPendingStageOwnership(useStore.getState()).length === 0, '资料整理不得将回测或其案例改归实盘阶段')
    const pool = buildReviewPoolCandidateIndex(useStore.getState().trades, [])
    assert(pool.system.all.length === 1 && pool.system.cases.length === 1, '仅提炼案例进入随机复盘池')
  } finally { useStore.setState(original, true) }
}

export function testBacktestMergeRemapsProjectCollisionsIdempotently(): void {
  const source = snapshot()
  const sourceCase = { ...record(2), tradeKind: 'case' as const, liveStageId: null, sourceTradeId: 'bt-1', sourceNoteHtml: record(1).note }
  const local = { ...source, trades: [...source.trades, sourceCase] }
  const imported = { ...snapshot(), trades: [...source.trades, sourceCase], backtestProjects: [{ ...project, name: '另一个项目' }], version: SCHEMA_VERSION }
  const merged = mergeImportPayload(local, imported, 'backtest-collision')
  assert(merged.backtestProjects?.length === 2 && merged.trades.length === 4, '同ID不同项目应独立保留')
  const importedRecord = merged.trades.find(trade => trade.backtestProjectId !== 'bt')
  assert(Boolean(importedRecord), '成员必须跟随新项目ID')
  const repeated = mergeImportPayload(merged, imported, 'backtest-collision')
  assert(repeated.backtestProjects?.length === 2 && repeated.trades.length === 4, '重复导入不得增殖')
}

export function testBacktestDetailAndNewRecordKeepProjectContext(): void {
  const current = record(1)
  const nav = getDetailNavigation([current, record(2), { ...record(3), backtestProjectId: 'other' }], null, current)
  assert(nav?.orderedIds.length === 2, '详情导航不能跨项目')
  assert(backtestProjectIdForPath('/trade/TRD-1', [current]) === 'bt', '详情新建必须继承项目')
}

export async function testBacktestAnalysisExportOnlyIncludesProjectMembers(): Promise<void> {
  const blob = await buildBacktestAnalysisPackage(project, [record(1), { ...record(2), backtestProjectId: 'other' }], async () => null)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const payload = JSON.parse(await zip.file('project.json')!.async('string'))
  assert(payload.trades.length === 1 && payload.summary.evaluatedCount === 1, '分析包只含本项目')
  assert(Boolean(zip.file('README.md') && zip.file('trades.csv')), '分析说明与表格必须随包导出')
}

export function testBacktestDraftAndBreakevenDoNotInventCashResults(): void {
  const draft = { ...record(1), status: 'planned' as const, rMultiple: null, resultSource: undefined, closedAt: null }
  const decoded = decodeCanonicalSnapshot({ ...snapshot(), trades: [draft] }, { version: SCHEMA_VERSION })
  assert(summarizeBacktest(decoded.trades).evaluatedCount === 0, '留空暂存不得算完成')
  const closed = prepareTradeClose(draft, { outcome: 'breakeven', resultMode: 'r', pnl: null, rMultiple: null, closedAt: '2025-03-01' })
  assert(closed.ok && closed.patch.pnl === null && closed.patch.rMultiple === 0 && closed.patch.resultSource === 'r', '回测保本不得伪造现金结果')
}

export function testBacktestRulesStayFixedAndStrategyReferencesFollowDeletion(): void {
  const original = useStore.getState()
  try {
    useStore.setState({
      ...snapshot(),
      backtestProjects: [{ ...project, defaultStrategyId: 'uncategorized' }],
      strategies: [{ id: 'uncategorized', name: '默认', icon: 'trending-up', color: '#5e6ad2' }, { id: 'replacement', name: '替代分类', icon: 'activity', color: '#5e6ad2' }],
    })
    useStore.getState().saveBacktestProject({ ...project, rules: '另一套规则', symbol: 'EURUSD' })
    assert(useStore.getState().backtestProjects[0]?.rules === project.rules, '已有样本后不能改写规则与品种')
    useStore.getState().removeStrategy('uncategorized', 'replacement')
    assert(useStore.getState().backtestProjects[0]?.defaultStrategyId === 'replacement', '项目默认分类需同步重新归类')
    assert(useStore.getState().trades[0]?.strategyId === 'replacement', '原样本分类需同步重新归类')
    const current = useStore.getState().backtestProjects[0]!
    useStore.getState().saveBacktestProject({ ...current, targetCount: 150, completedAt: '2026-10-01T00:00:00Z' })
    assert(useStore.getState().backtestProjects[0]?.targetCount === 150, '完成后目标仍可调整')
  } finally { useStore.setState(original, true) }
}

export function testBacktestCopyAndTrashPreserveProjectAndConfirmedProgress(): void {
  const original = useStore.getState()
  try {
    useStore.setState(snapshot())
    const copied = copyTradeRecord('bt-1', { createId: () => 'bt-copy' })
    assert(copied.status === 'copied', '回测可使用共享复制动作')
    assert(copied.copy.backtestProjectId === 'bt' && copied.copy.openedAt === record(1).openedAt, '复制保留项目和历史日期')
    assert(copied.copy.rMultiple === null && copied.copy.note === '', '副本清空结果和复盘正文')
    assert(summarizeBacktest(getProjectTrades(useStore.getState().trades, 'bt')).evaluatedCount === 1, '副本不得增加已确认进度')
    useStore.getState().removeTrades(['bt-1', 'bt-copy'])
    assert(getProjectTrades(useStore.getState().trades, 'bt').length === 0, '批量删除移入回收站并排除项目统计')
    const actionId = useStore.getState().undoStack.at(-1)?.actionId
    assert(actionId && useStore.getState().undo(actionId), '批量删除可安全撤销')
    assert(getProjectTrades(useStore.getState().trades, 'bt').length === 2, '撤销恢复相同项目记录')
    useStore.setState({ backtestProjects: [{ ...project, archivedAt: '2026-10-01T00:00:00Z' }] })
    const rejected = copyTradeRecord('bt-1', { createId: () => 'archived-copy' })
    assert(rejected.status === 'failed' && rejected.reason === 'project-archived', '详情入口同样不能绕过归档复制限制')
    assert(useStore.getState().trades.length === 2, '归档拒绝复制不得写入副本')
  } finally { useStore.setState(original, true) }
}

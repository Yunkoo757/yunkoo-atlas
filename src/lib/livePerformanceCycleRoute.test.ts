import {
  resolvePerformanceAnalysisRoute,
  resolveTradeListPerformanceCycleRoute,
  writePerformanceAnalysisCycle,
  writeTradeListPerformanceCycle,
} from '@/lib/livePerformanceCycleRoute'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const cycles: LivePerformanceCycle[] = [
  { id: 'old-id', name: '旧周期', startTradingDayKey: '2026-04-01', createdAt: '2026-04-01T00:00:00.000Z' },
  { id: 'current-id', name: '当前周期', startTradingDayKey: '2026-07-01', createdAt: '2026-07-01T00:00:00.000Z' },
]

export function testAnalysisRouteCompressesTheCurrentCycleId(): void {
  const current = resolvePerformanceAnalysisRoute('?kind=live&statsCycle=current-id&visual=x', 'live', cycles)

  assert(current.canonicalSearch === '?kind=live&visual=x', '分析页当前周期 ID 必须压缩')
  assert(current.resolved.cycleId === 'current-id', '省略当前 ID 仍必须解析为当前周期')
  assert(current.needsReplace, '压缩当前 ID 必须替换 URL')
}

export function testAnalysisRoutePreservesHistoricalCycleAndUnrelatedOrder(): void {
  const historical = resolvePerformanceAnalysisRoute('?visual=x&kind=live&statsCycle=old-id&range=30d', 'live', cycles)

  assert(historical.resolved.cycleId === 'old-id', '历史周期 ID 必须保留')
  assert(
    historical.canonicalSearch === '?visual=x&kind=live&statsCycle=old-id&range=30d',
    '无须规范化时必须保留无关参数与原有稳定顺序',
  )
  assert(!historical.needsReplace, '已经规范的历史周期 URL 不得替换')
}

export function testAnalysisRouteRemovesStatsCycleOutsideLiveMode(): void {
  const paper = resolvePerformanceAnalysisRoute('?kind=paper&statsCycle=old-id&visual=x', 'paper', cycles)

  assert(!paper.canonicalSearch.includes('statsCycle'), '非实盘模式必须移除 statsCycle')
  assert(paper.canonicalSearch.includes('visual=x'), '移除 statsCycle 不得丢失无关参数')
  assert(paper.needsReplace, '非实盘移除 statsCycle 必须替换 URL')
}

export function testAnalysisRouteFallsBackInvalidIdsToCompressedCurrent(): void {
  const route = resolvePerformanceAnalysisRoute('?kind=live&statsCycle=missing&visual=x', 'live', cycles)

  assert(route.resolved.cycleId === 'current-id', '非法统计周期必须回退当前周期')
  assert(route.canonicalSearch === '?kind=live&visual=x', '非法统计周期必须压缩为隐式当前周期')
  assert(route.needsReplace, '非法统计周期必须标记替换')
}

export function testEmptyCycleAnalysisRouteRemovesEveryStatsCycleAliasAndStaysCanonical(): void {
  for (const requested of ['pre-cycle', 'all', 'current', 'missing', 'cycle-looking-id']) {
    const route = resolvePerformanceAnalysisRoute(
      `?kind=live&statsCycle=${requested}&visual=x`,
      'live',
      [],
    )

    assert(route.resolved.key === 'all' && route.resolved.bounds === null, '空周期集合必须解析为全部历史')
    assert(route.canonicalSearch === '?kind=live&visual=x', `空周期集合必须清除 ${requested} 并保留无关参数`)
    assert(route.needsReplace, `清除空周期集合的 ${requested} 必须触发 canonical replace`)

    const canonical = resolvePerformanceAnalysisRoute(route.canonicalSearch, 'live', [])
    assert(canonical.canonicalSearch === route.canonicalSearch, '规范 URL 再解析必须稳定')
    assert(!canonical.needsReplace, '规范 URL 不得产生 replace 循环')
  }
}

export function testUndoingTheOnlyCycleCanonicalizesItsFormerVirtualScope(): void {
  const soleCycle = [cycles[1]!]
  const beforeUndo = resolvePerformanceAnalysisRoute(
    '?kind=live&statsCycle=pre-cycle&visual=x',
    'live',
    soleCycle,
  )
  assert(!beforeUndo.needsReplace, '唯一周期存在时统计起点前必须是稳定可寻址范围')

  const afterUndo = resolvePerformanceAnalysisRoute(beforeUndo.canonicalSearch, 'live', [])
  assert(afterUndo.canonicalSearch === '?kind=live&visual=x', '撤销唯一周期后必须清除已消失的虚拟范围')
  assert(afterUndo.needsReplace, '撤销唯一周期后必须执行真实 canonical replace')
}

export function testStatsCycleWinsOverAndRemovesRiskLiveCycle(): void {
  const route = resolvePerformanceAnalysisRoute('?kind=live&liveCycle=pre-cycle&statsCycle=old-id&visual=x', 'live', cycles)

  assert(route.resolved.cycleId === 'old-id', 'statsCycle 必须优先于风险 liveCycle')
  assert(!route.canonicalSearch.includes('liveCycle'), '分析 URL 不得保留风险 liveCycle')
  assert(route.canonicalSearch.includes('statsCycle=old-id'), '统计周期必须保留')
}

export function testWritingAnalysisCycleResetsRelativeRangeAndCompressesCurrent(): void {
  const current = writePerformanceAnalysisCycle('?kind=live&range=30d&visual=x', 'current', cycles)
  const historical = writePerformanceAnalysisCycle('?kind=live&range=90d&visual=x', 'old-id', cycles)

  assert(current.get('range') === 'all', '选择当前周期必须重置为全部时间')
  assert(!current.has('statsCycle'), '当前周期必须压缩为缺省 URL')
  assert(historical.get('range') === 'all', '选择历史周期必须重置为全部时间')
  assert(historical.get('statsCycle') === 'old-id', '历史周期必须显式写入')
  assert(historical.get('visual') === 'x', '写周期不得丢失无关参数')
}

export function testWritingAnalysisCycleCannotCreateStatsCycleForAnEmptyLibrary(): void {
  for (const selected of ['current', 'pre-cycle', 'all', 'cycle-looking-id'] as const) {
    const written = writePerformanceAnalysisCycle(
      '?kind=live&range=30d&statsCycle=stale&visual=x',
      selected,
      [],
    )
    assert(!written.has('statsCycle'), `空周期集合写入 ${selected} 时不得制造误导 URL`)
    assert(written.get('range') === 'all', '选择周期仍必须重置相对日期范围')
    assert(written.get('visual') === 'x', '空周期写入不得丢失无关参数')
  }
}

export function testTradeListKeepsExplicitCurrentIdAndCanClearInvalidSelection(): void {
  const selected = writeTradeListPerformanceCycle('?liveCycle=pre-cycle&visual=x', 'current-id')
  const cleared = writeTradeListPerformanceCycle('?statsCycle=missing&visual=x', null)

  assert(selected.get('statsCycle') === 'current-id', '交易列表当前周期 ID 必须显式保留，因为列表默认不过滤')
  assert(!selected.has('liveCycle'), '交易列表统计周期不得携带风险 liveCycle')
  assert(!cleared.has('statsCycle'), '无效列表 ID 必须可以删除而非回退当前周期')
  assert(cleared.get('visual') === 'x', '删除列表周期不得丢失无关参数')
}

export function testTradeListRouteAlreadyClearsStatsCycleWhenTheLibraryIsEmpty(): void {
  const route = resolveTradeListPerformanceCycleRoute(
    '?statsCycle=pre-cycle&liveCycle=pre-cycle&symbol=BTCUSDT',
    [],
    true,
  )

  assert(route.resolved === null, '空周期集合的交易列表不得解析出统计周期')
  assert(route.canonicalSearch === '?symbol=BTCUSDT', '空周期集合必须清除失效周期和冲突风险参数')
  assert(route.needsReplace, '交易列表清除失效周期必须触发 replace')
}

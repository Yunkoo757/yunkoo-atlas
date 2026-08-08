import type { Trade } from '@/data/trades'
import {
  appendLivePerformanceCycle,
  assertValidLivePerformanceCycles,
  countLiveTradesMissingCloseDay,
  filterTradesByLivePerformanceCycle,
  renameLivePerformanceCycle,
  resolveLivePerformanceCloseTradingDayKey,
  resolveLivePerformanceCycle,
  undoLatestLivePerformanceCycle,
} from '@/lib/livePerformanceCycles'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function cycle(id: string, name: string, startTradingDayKey: string) {
  return { id, name, startTradingDayKey, createdAt: '2026-01-01T00:00:00.000Z' }
}

function closedLive(id: string, patch: Partial<Trade> = {}): Trade {
  return {
    id, ref: `TRD-${id}`, symbol: 'BTCUSD', side: 'long', status: 'win', conviction: 'medium',
    strategyId: 'strategy-1', tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal',
    tradeKind: 'live', entry: 1, exit: 2, size: 1, pnl: 1, rMultiple: 1,
    openedAt: '2026-01-01', closedAt: '2026-01-01', note: '',
    ...patch,
  }
}

function ids(trades: readonly Trade[]): string {
  return trades.map((trade) => trade.id).join(',')
}

const cycles = [
  cycle('one', '第一期', '2026-01-01'),
  cycle('two', '第二期', '2026-04-01'),
  cycle('three', '第三期', '2026-07-01'),
]

const trades = [
  closedLive('before-first', { closedAt: '2025-12-31' }),
  closedLive('on-first', { closedAt: '2026-01-01' }),
  closedLive('before-second', { closedAt: '2026-03-31' }),
  closedLive('on-second', { closedAt: '2026-04-01' }),
  closedLive('before-third', { closedAt: '2026-06-30' }),
  closedLive('on-third', { closedAt: '2026-07-01' }),
  closedLive('after-third', { closedAt: '2026-07-02' }),
]

export function testPerformanceCyclesUseHalfOpenCloseDayIntervals(): void {
  const current = resolveLivePerformanceCycle(cycles, null)
  const previous = resolveLivePerformanceCycle(cycles, 'one')
  assert(ids(filterTradesByLivePerformanceCycle(trades, current, 0)) === 'on-third,after-third', '当前周期必须包含最后边界及其后交易')
  assert(ids(filterTradesByLivePerformanceCycle(trades, previous, 0)) === 'on-first,before-second', '历史周期必须是左闭右开区间')
  assert(ids(filterTradesByLivePerformanceCycle(trades, resolveLivePerformanceCycle(cycles, 'pre-cycle'), 0)) === 'before-first', '周期前必须仅包含第一边界前交易')
}

export function testCrossBoundaryTradeBelongsToCloseDayCycle(): void {
  const trade = closedLive('cross', { openedAt: '2026-03-30', closedAt: '2026-04-02' })
  const result = filterTradesByLivePerformanceCycle([trade], resolveLivePerformanceCycle(cycles, 'two'), 0)
  assert(result[0]?.id === 'cross', '跨周期交易必须按平仓交易日进入新周期')
}

export function testCycleResolutionFallsBackWithoutMutatingInput(): void {
  const source = cycles.map((item) => ({ ...item }))
  const empty = resolveLivePerformanceCycle([], 'one')
  const pre = resolveLivePerformanceCycle(source, 'pre-cycle')
  const current = resolveLivePerformanceCycle(source, null)
  const unknown = resolveLivePerformanceCycle(source, 'missing')
  assert(empty.key === 'all' && empty.bounds === null, '空周期必须解析为全部')
  assert(pre.bounds?.startInclusive === null && pre.bounds?.endExclusive === '2026-01-01', '周期前必须在第一边界前无下界')
  assert(current.key === 'three' && current.isCurrent && current.cycleId === 'three', '当前周期必须是最新边界而非存储的当前 ID')
  assert(unknown.key === 'three' && unknown.wasFallback && unknown.requestedKey === 'missing', '未知请求必须回退当前周期')
  assert(source.map((item) => item.id).join(',') === 'one,two,three', '回退不能变异输入数组')
}

export function testCycleFilteringUsesFrozenCloseDayAndExcludesIneligibleTrades(): void {
  const resolved = resolveLivePerformanceCycle(cycles, 'two')
  const candidates = [
    closedLive('frozen-wins', { closedTradingDayKey: '2026-04-01', closedAt: '2026-03-31' }),
    closedLive('case', { tradeKind: 'case', closedAt: '2026-04-02' }),
    closedLive('paper', { tradeKind: 'paper', closedAt: '2026-04-02' }),
    closedLive('open', { status: 'open', closedAt: '2026-04-02' }),
    closedLive('missed', { status: 'missed', closedAt: '2026-04-02' }),
    closedLive('deleted', { deletedAt: '2026-04-02T00:00:00.000Z', closedAt: '2026-04-02' }),
    closedLive('empty-deleted', { deletedAt: '', closedAt: '2026-04-02' }),
  ]
  assert(ids(filterTradesByLivePerformanceCycle(candidates, resolved, 0)) === 'frozen-wins', '只允许未删除、已平仓的实盘，并优先使用冻结平仓日')
}

export function testMalformedCloseDatesAreCountedAndNeverAttributed(): void {
  const malformed = [
    closedLive('bad-frozen', { closedTradingDayKey: '2026-02-30', closedAt: '2026-04-02' }),
    closedLive('bad-closed', { closedAt: 'not-a-date' }),
    closedLive('missing', { closedAt: null }),
  ]
  assert(countLiveTradesMissingCloseDay(malformed, 0) === 3, '无效或缺失平仓日必须计数')
  assert(ids(filterTradesByLivePerformanceCycle(malformed, resolveLivePerformanceCycle(cycles, 'two'), 0)) === '', '无效平仓日不得进入任何周期')
}

export function testCloseDayResolutionNeverFallsBackFromAnInvalidFrozenDay(): void {
  const frozenInvalid = closedLive('frozen-invalid', { closedTradingDayKey: '2026-02-30', closedAt: '2026-04-02' })
  const legacy = closedLive('legacy', { closedTradingDayKey: undefined, closedAt: '2026-04-02' })
  assert(resolveLivePerformanceCloseTradingDayKey(frozenInvalid, 0) === null, '无效冻结日不得悄悄回退到 closedAt')
  assert(resolveLivePerformanceCloseTradingDayKey(legacy, 0) === '2026-04-02', '未冻结的旧记录才允许由合法 closedAt 补算')
}

export function testCycleValidationRejectsMalformedAndUnorderedRecords(): void {
  const invalidSets: unknown[] = [
    [cycle('one', '第一期', '2026-01-01'), cycle('one', '第二期', '2026-04-01')],
    [cycle('one', '第一期', '2026-01-01'), cycle('two', '第一期', '2026-04-01')],
    [cycle('one', '第一期', '2026-01-01'), cycle('two', '第二期', '2026-01-01')],
    [cycle('one', '第一期', '2026-02-30')],
    [{ ...cycle('one', '第一期', '2026-01-01'), createdAt: 'not-an-iso-instant' }],
    [cycle('two', '第二期', '2026-04-01'), cycle('one', '第一期', '2026-01-01')],
    [cycle('one', '', '2026-01-01')],
    [cycle('one', '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一', '2026-01-01')],
  ]
  for (const value of invalidSets) {
    let rejected = false
    try { assertValidLivePerformanceCycles(value) } catch { rejected = true }
    assert(rejected, '非法周期持久化数据必须被拒绝')
  }
}

export function testCycleValidationRejectsUnaddressableIds(): void {
  const accepted: string[] = []
  for (const id of [' padded-id ', 'all', 'pre-cycle', 'current']) {
    try {
      assertValidLivePerformanceCycles([cycle(id, `周期 ${id}`, '2026-01-01')])
      accepted.push(id)
    } catch {
      // 预期拒绝，继续检查所有保留值，避免首个失败遮蔽其余契约。
    }
  }
  assert(accepted.length === 0, `不可寻址周期 ID 必须全部拒绝，实际接受：${accepted.join(',')}`)
}

export function testCycleEditsEnforceChronologyAndReturnNewArrays(): void {
  const original = cycles.map((item) => ({ ...item }))
  const appended = appendLivePerformanceCycle(original, cycle('four', '第四期', '2026-08-01'), '2026-08-01')
  assert(appended !== original, '新增必须返回新数组')
  assert(appended.at(-1)?.id === 'four', '新增必须保留新边界')
  for (const bad of ['2026-07-01', '2026-08-02']) {
    let rejected = false
    try { appendLivePerformanceCycle(original, cycle('bad', '坏周期', bad), '2026-08-01') } catch { rejected = true }
    assert(rejected, '新增不得晚于当前日且必须晚于最新边界')
  }
  const renamed = renameLivePerformanceCycle(original, 'one', '重命名')
  assert(renamed !== original && renamed[0]?.name === '重命名' && original[0]?.name === '第一期', '重命名必须克隆且不变异输入')
  for (const name of [' ', '第二期']) {
    let rejected = false
    try { renameLivePerformanceCycle(original, 'one', name) } catch { rejected = true }
    assert(rejected, '重命名不得为空或重复')
  }
  const undone = undoLatestLivePerformanceCycle(original)
  assert(undone !== original && undone.map((item) => item.id).join(',') === 'one,two', '撤销只能移除最新边界')
  assert(original.map((item) => item.id).join(',') === 'one,two,three' && trades.length === 7, '撤销不得触碰输入或交易')
}

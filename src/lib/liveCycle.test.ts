import type { RiskPolicyVersion } from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import {
  buildLiveCyclePreview,
  classifyLiveCycleTrade,
  filterTradesForLiveCycle,
  openedTradingDayKey,
  parseLiveCycleScope,
  suggestLiveCycleStartTradingDayKey,
} from '@/lib/liveCycle'
import { getWorkbenchVisibleTrades } from '@/lib/workbenchTrades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { getTradingDayKey } from '@/lib/periods'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function trade(id: string, openedAt: string, tradeKind: Trade['tradeKind'] = 'live'): Trade {
  return {
    id, ref: `TRD-${id}`, symbol: 'GBPUSD', side: 'short', status: 'loss',
    conviction: 'medium', strategyId: 'strategy-1', tradeKind,
    tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal',
    entry: 1.3, exit: 1.31, size: 1, pnl: -80, rMultiple: -1,
    resultSource: 'pnl', openedAt, closedAt: '2026-07-27', note: '',
  }
}

export function testLiveCycleIncludesBoundaryAndUsesTradingDayStartHour(): void {
  assert(classifyLiveCycleTrade(trade('boundary', '2026-07-27'), '2026-07-27', 6) === 'current', '起点日必须进入当前周期')
  assert(classifyLiveCycleTrade(trade('before-hour', '2026-07-27T05:30:00'), '2026-07-27', 6) === 'pre-cycle', '无 offset 时间必须保持本地墙钟语义')
  assert(classifyLiveCycleTrade(trade('after-hour', '2026-07-27T06:30:00'), '2026-07-27', 6) === 'current', '无 offset 时间必须按交易日起始小时换日')
}

export function testLiveCycleOffsetTimestampsUseTheirRealInstant(): void {
  const startHour = 6
  const offsetTimestamps = [
    '2026-07-27T01:00:00.000Z',
    '2026-07-27T05:30:00+08:00',
    '2026-07-27T23:30:00-04:00',
  ]
  for (const openedAt of offsetTimestamps) {
    assert(
      openedTradingDayKey(trade(openedAt, openedAt), startHour) === getTradingDayKey(new Date(openedAt), startHour),
      `${openedAt} 必须按真实 instant 换算交易日`,
    )
  }

  const sameInstantWithZ = '2026-07-27T08:00:00.000Z'
  const sameInstantWithNegativeOffset = '2026-07-27T04:00:00.000-04:00'
  assert(
    openedTradingDayKey(trade('same-z', sameInstantWithZ), startHour) ===
      openedTradingDayKey(trade('same-negative', sameInstantWithNegativeOffset), startHour),
    '同一 instant 的 Z 与负 offset 表示必须得到同一交易日',
  )

  const localBeforeBoundary = new Date(2026, 6, 27, startHour - 1, 59).toISOString()
  const localAfterBoundary = new Date(2026, 6, 27, startHour, 1).toISOString()
  assert(openedTradingDayKey(trade('z-before-boundary', localBeforeBoundary), startHour) === '2026-07-26', 'Z 时间在本地交易日边界前必须归前一日')
  assert(openedTradingDayKey(trade('z-after-boundary', localAfterBoundary), startHour) === '2026-07-27', 'Z 时间在本地交易日边界后必须归当日')
}

export function testLiveCyclePreviewDoesNotHideUnresolvedOrRewritePaper(): void {
  const trades = [
    trade('old', '2026-07-26'),
    trade('new', '2026-07-27'),
    trade('bad', 'not-a-date'),
    trade('paper', '2026-07-20', 'paper'),
  ]
  const preview = buildLiveCyclePreview(trades, '2026-07-27', 0)
  assert(preview.preCycle.map((item) => item.id).join() === 'old', '只应预览规则前实盘')
  assert(preview.current.map((item) => item.id).join() === 'new', '边界日实盘必须保留')
  assert(preview.unresolved.map((item) => item.id).join() === 'bad', '非法开仓日必须阻止静默归类')
  assert(filterTradesForLiveCycle(trades, 'current', '2026-07-27', 0).some((item) => item.id === 'bad'), '当前范围必须保守保留无法判断记录')
  assert(filterTradesForLiveCycle(trades, 'current', '2026-07-27', 0).some((item) => item.id === 'paper'), '混合分析不得误删模拟盘')
}

export function testLiveCycleSuggestsEarliestEffectivePolicy(): void {
  const policies = [
    { id: 'later', effectiveTradingDay: '2026-08-03' },
    { id: 'first', effectiveTradingDay: '2026-07-27' },
  ] as RiskPolicyVersion[]
  assert(suggestLiveCycleStartTradingDayKey(policies) === '2026-07-27', '必须建议最早有效规则日')
}

export function testLiveCycleScopeParsingIsStable(): void {
  assert(parseLiveCycleScope('') === 'current', '缺省必须是当前周期')
  assert(parseLiveCycleScope('?liveCycle=pre-cycle') === 'pre-cycle', '必须识别规则前范围')
  assert(parseLiveCycleScope('?liveCycle=all') === 'all', '必须识别全部实盘范围')
  assert(parseLiveCycleScope('?liveCycle=broken') === 'current', '非法值必须回退当前周期')
}

export function testPreCycleScopeWithoutStartKeepsDefaultHistoryVisible(): void {
  const trades = [trade('old', '2026-07-26'), trade('new', '2026-07-27')]
  assert(
    filterTradesForLiveCycle(trades, 'pre-cycle', null, 0).map((item) => item.id).join() === 'old,new',
    '未启用周期时规则前范围必须回退默认历史，不能过滤为空',
  )
}

export function testPaperAnalysisIgnoresLiveCycleUrl(): void {
  const paper = trade('paper', '2026-07-26', 'paper')
  const visible = getWorkbenchVisibleTrades({
    trades: [trade('old-live', '2026-07-26'), paper],
    filter: {
      type: 'strategy',
      strategyId: 'strategy-1',
      analysisScope: { kind: 'paper', range: 'all' },
    },
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false, tradingDayStartHour: 0 },
    search: '?liveCycle=pre-cycle',
    liveStatsStartTradingDayKey: '2026-07-27',
  })
  assert(visible.map((item) => item.id).join() === 'paper', '纯模拟分析不得受实盘周期 URL 影响')
}

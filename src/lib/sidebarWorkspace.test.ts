import type { Trade } from '@/data/trades'
import {
  countSidebarRoute,
  countSidebarTarget,
  normalizeStrategySources,
  parseStrategySourcesSearch,
  setStrategySourceEnabled,
  writeStrategySourcesSearch,
} from '@/lib/sidebarWorkspace'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function liveTrade(id: string, liveStageId: string): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'open',
    conviction: 'medium',
    strategyId: 'strategy',
    tradeKind: 'live',
    liveStageId,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: id === 'historical' ? '2099-12-31' : '2000-01-01',
    closedAt: null,
    note: '',
  }
}

export function testSidebarCurrentLiveCountsUseCurrentStageId(): void {
  const context = {
    trades: [liveTrade('historical', 'stage-old'), liveTrade('current', 'stage-current')],
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    currentLiveStageId: 'stage-current',
  }

  const count = countSidebarRoute('/active', '', context)

  assert(count === 1, '侧栏进行中计数只能统计 currentLiveStageId')
}

export function testSidebarMissedAggregateKeepsPaperButScopesLiveAndCasesToCurrentStage(): void {
  const makeMissed = (id: string, tradeKind: 'live' | 'paper' | 'case', liveStageId?: string): Trade => ({
    ...liveTrade(id, liveStageId ?? 'stage-current'),
    tradeKind,
    status: 'missed',
    ...(tradeKind === 'case' ? { caseType: 'missed' as const } : {}),
    ...(tradeKind === 'paper' ? {} : { liveStageId }),
  } as Trade)
  const context = {
    trades: [
      makeMissed('historical-live', 'live', 'stage-old'),
      makeMissed('current-live', 'live', 'stage-current'),
      makeMissed('historical-case', 'case', 'stage-old'),
      makeMissed('current-case', 'case', 'stage-current'),
      makeMissed('paper', 'paper'),
    ],
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    currentLiveStageId: 'stage-current',
  }
  const target: Parameters<typeof countSidebarTarget>[0] = {
    item: {
      id: 'system:missed',
      target: { kind: 'system' as const, id: 'missed' as const, workspaces: ['trade', 'paper', 'case'] },
      placement: 'pinned' as const,
      order: 0,
    },
    key: 'system:missed',
    label: '错过的机会',
    pathname: '/missed',
    search: '',
    icon: 'missed' as const,
    invalid: false,
  }

  const count = countSidebarTarget(target, context)

  assert(count === 3, '错过计数必须保留 paper，同时只统计当前 stage 的 live/case')
}

export function testStrategySourcesDefaultToCurrentLiveAndCanCombine(): void {
  assert(parseStrategySourcesSearch('').join() === 'trade', '缺省策略来源必须是当前实盘')
  assert(writeStrategySourcesSearch(['trade']) === '', '仅当前实盘不得写入多余 query')
  assert(
    writeStrategySourcesSearch(['case', 'trade', 'paper']) === '?sources=trade,paper,case',
    '策略来源必须按稳定顺序写入',
  )
  assert(normalizeStrategySources(['paper', 'paper', 'ghost']).join() === 'paper', '非法来源必须剔除')

  const items = setStrategySourceEnabled(
    [{
      id: 'strategy:strategy-1',
      target: { kind: 'strategy', strategyId: 'strategy-1' },
      placement: 'pinned',
      order: 0,
    }],
    'strategy-1',
    'case',
    true,
  )
  assert(
    items[0]?.target.kind === 'strategy' && items[0].target.workspaces?.join() === 'trade,case',
    '勾选案例必须在保留当前实盘的同时写入策略来源',
  )
  const refused = setStrategySourceEnabled(items, 'strategy-1', 'trade', false)
  const stillHasCase = setStrategySourceEnabled(refused, 'strategy-1', 'case', false)
  assert(stillHasCase === refused, '最后一个来源不得被关掉')
}

export function testCaseSidebarCountIncludesHistoricalCases(): void {
  const context = {
    trades: [
      { ...liveTrade('old-case', 'stage-old'), tradeKind: 'case' as const },
      { ...liveTrade('current-case', 'stage-current'), tradeKind: 'case' as const },
      liveTrade('current-live', 'stage-current'),
    ],
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    currentLiveStageId: 'stage-current',
  }

  assert(countSidebarRoute('/review-cases', '', context) === 2, '案例记录侧栏计数必须含全部历史案例')
  assert(countSidebarRoute('/review-cases/exemplar', '', context) === 0, '未标记优秀范例时交易案例计数应为 0')
}

export function testStrategySidebarCountUsesCombinedSources(): void {
  const context = {
    trades: [
      liveTrade('current-live', 'stage-current'),
      liveTrade('old-live', 'stage-old'),
      { ...liveTrade('paper', 'stage-current'), tradeKind: 'paper' as const },
      { ...liveTrade('old-case', 'stage-old'), tradeKind: 'case' as const },
    ],
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    currentLiveStageId: 'stage-current',
  }

  const liveOnly = countSidebarRoute('/strategy/strategy', '', context)
  const combined = countSidebarRoute('/strategy/strategy', '?sources=trade,paper,case', context)

  assert(liveOnly === 1, '默认策略计数只能统计当前阶段实盘')
  assert(combined === 3, '合并来源必须加上模拟盘与历史案例，且不含历史实盘')
}

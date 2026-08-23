import type { Trade } from '@/data/trades'
import type { SidebarQuickWorkspace } from '@/lib/sidebarWorkspace'
import { deriveWorkbenchVisibleTrades } from '@/lib/workbenchTrades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function trade(id: string, tradeKind: 'live' | 'paper' | 'case', liveStageId?: string | null): Trade {
  const base = {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long' as const,
    status: 'open' as const,
    conviction: 'medium' as const,
    strategyId: 'strategy',
    tradeKind,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed' as const,
    reviewCategory: 'normal' as const,
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2099-12-31',
    closedAt: null,
    note: '',
  }
  return tradeKind === 'paper' ? base : { ...base, liveStageId }
}

export function testCurrentWorkbenchUsesExplicitStageOwnership(): void {
  const options = {
    trades: [
      trade('historical-new-date', 'live', 'stage-old'),
      trade('current-old-date', 'live', 'stage-current'),
    ],
    filter: { type: 'active' as const, tradeKind: 'live' as const },
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    search: '',
    stageScope: { kind: 'current' as const, stageId: 'stage-current' },
  }

  const result = deriveWorkbenchVisibleTrades(options)

  assert(result.visible.map((item) => item.id).join() === 'current-old-date', '当前工作台只能显示 currentLiveStageId 的实盘记录')
}

export function testPaperWorkbenchKeepsItsOriginalSemantics(): void {
  const options = {
    trades: [trade('paper', 'paper'), trade('current', 'live', 'stage-current')],
    filter: { type: 'all' as const, tradeKind: 'paper' as const },
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    search: '',
    stageScope: { kind: 'current' as const, stageId: 'stage-current' },
  }

  const result = deriveWorkbenchVisibleTrades(options)

  assert(result.visible.map((item) => item.id).join() === 'paper', 'stage scope 不得改变模拟盘原有语义')
}

export function testStrategyCombinedSourcesKeepLiveCurrentAndCasesAcrossStages(): void {
  const options = {
    trades: [
      trade('current-live', 'live', 'stage-current'),
      trade('old-live', 'live', 'stage-old'),
      trade('paper', 'paper'),
      trade('old-case', 'case', 'stage-old'),
      trade('current-case', 'case', 'stage-current'),
      { ...trade('other-strategy', 'live', 'stage-current'), strategyId: 'other' },
    ],
    filter: {
      type: 'strategy' as const,
      strategyId: 'strategy',
      strategySources: ['trade', 'paper', 'case'] as SidebarQuickWorkspace[],
      liveStageId: 'stage-current',
    },
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    search: '?sources=trade,paper,case',
  }

  const result = deriveWorkbenchVisibleTrades(options)
  assert(
    result.visible.map((item) => item.id).sort().join() === 'current-case,current-live,old-case,paper',
    '策略合并列表必须只含当前实盘，并纳入模拟盘与全部历史案例',
  )
}

export function testCaseWorkbenchKeepsAllStagesAsKnowledgeBase(): void {
  const options = {
    trades: [
      trade('old-case', 'case', 'stage-old'),
      trade('current-case', 'case', 'stage-current'),
      trade('pending-case', 'case', null),
      trade('current-live', 'live', 'stage-current'),
    ],
    filter: { type: 'all' as const, tradeKind: 'case' as const },
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    search: '',
    stageScope: { kind: 'current' as const, stageId: 'stage-current' },
  }

  const result = deriveWorkbenchVisibleTrades(options)
  assert(
    result.visible.map((item) => item.id).sort().join() === 'current-case,old-case,pending-case',
    '案例记录必须跨阶段保留，不得被新实盘阶段切空',
  )
}

export function testHistoricalCaseWorkbenchUsesCaseStageOwnership(): void {
  const options = {
    trades: [
      trade('stage-one-case', 'case', 'stage-1'),
      trade('stage-two-case', 'case', 'stage-2'),
      trade('pending-case', 'case', null),
    ],
    filter: { type: 'all' as const, tradeKind: 'case' as const, historicalLiveScope: 'cases' as const },
    starredIds: [],
    display: { ...DEFAULT_DISPLAY, hideClosed: false },
    search: '?liveStage=stage-2',
    stageScope: { kind: 'stage' as const, stageId: 'stage-2' },
  }

  const result = deriveWorkbenchVisibleTrades(options)

  assert(result.visible.map((item) => item.id).join() === 'stage-two-case', '历史案例必须按案例自身 stage ID 投影')
}

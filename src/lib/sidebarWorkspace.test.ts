import type { Trade } from '@/data/trades'
import { countSidebarRoute, countSidebarTarget } from '@/lib/sidebarWorkspace'
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

import { createEmptyPersistedSnapshot } from '../src/storage/emptySnapshot'
import type { PersistedSnapshot } from '../src/storage/types'

export function createElectronQaSeedSnapshot(): PersistedSnapshot {
  const snapshot = createEmptyPersistedSnapshot()
  return {
    ...snapshot,
    trades: [
      {
        id: 'qa-trade-1',
        ref: 'TRD-QA1',
        symbol: 'BTC',
        side: 'long',
        status: 'win',
        conviction: 'medium',
        strategyId: 'qa-strategy',
        tags: ['qa'],
        mistakeTags: [],
        reviewStatus: 'unreviewed',
        reviewCategory: 'normal',
        tradeKind: 'live',
        entry: 100,
        exit: 110,
        size: 1,
        pnl: 10,
        rMultiple: 1,
        openedAt: '2026-01-01T00:00:00.000Z',
        closedAt: '2026-01-02T00:00:00.000Z',
        closedTradingDayKey: '2026-01-02',
        note: '<p>QA seed</p>',
        liveStageId: snapshot.currentLiveStageId,
      },
    ],
    strategies: [
      {
        id: 'qa-strategy',
        name: 'QA 策略',
        icon: 'target',
        color: '#6366f1',
      },
    ],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: {
      hideClosed: false,
      showEmptyGroups: true,
      groupByStrategy: false,
      groupByDate: true,
      sortBy: 'date',
      privacyMode: false,
      showKeyboardFocusRings: false,
      listRowDensity: 'compact',
      tradingDayStartHour: 6,
      sidebarPins: [],
      sidebarWorkspaceItems: [],
    },
  }
}

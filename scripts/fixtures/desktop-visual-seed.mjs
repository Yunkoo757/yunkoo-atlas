import { createAnalyticsSnapshot } from './analytics-trades.mjs'

const CURRENT_WEEK_START = '2026-08-10'

function patchTrade(trades, index, patch) {
  if (!trades[index]) throw new Error(`Desktop visual fixture is missing trade ${index}`)
  trades[index] = { ...trades[index], ...patch }
}

export function createDesktopVisualSnapshot() {
  const snapshot = createAnalyticsSnapshot({ count: 44, noteProfile: 'short' })
  const trades = snapshot.trades.map((trade) => ({ ...trade }))

  patchTrade(trades, 0, {
    ref: 'TRD-131',
    symbol: 'BTCUSDT',
    status: 'win',
    reviewStatus: 'unreviewed',
    openedAt: '2026-08-11T09:10:00+08:00',
    closedAt: '2026-08-12T11:35:00+08:00',
    closedTradingDayKey: '2026-08-12',
    pnl: 1_860,
    rMultiple: 2.4,
    resultSource: 'imported',
    note: '<p>日线趋势延续，回踩关键结构后按计划进场。</p><p>持仓期间没有移动止损，完整执行了出场方案。</p>',
  })
  patchTrade(trades, 1, {
    tradeKind: 'live',
    ref: 'TRD-132',
    symbol: 'XAUUSD',
    status: 'loss',
    reviewStatus: 'unreviewed',
    openedAt: '2026-08-10T14:20:00+08:00',
    closedAt: '2026-08-11T16:05:00+08:00',
    closedTradingDayKey: '2026-08-11',
    pnl: -620,
    rMultiple: -1,
    resultSource: 'imported',
    mistakeTags: ['提前进场'],
    note: '<p>确认信号尚未闭合就提前进场，止损本身执行正确。</p>',
  })
  patchTrade(trades, 2, {
    tradeKind: 'case',
    ref: 'CASE-017',
    caseType: 'exemplar',
    masteryState: 'recheck',
    nextReviewAt: '2026-08-12T09:00:00+08:00',
    reviewStatus: 'reviewed',
    note: '<p>高质量趋势案例：结构、节奏和风险预算全部满足。</p>',
  })
  patchTrade(trades, 3, {
    tradeKind: 'live',
    ref: 'TRD-133',
    symbol: 'SOLUSDT',
    status: 'missed',
    openedAt: '2026-08-12T10:30:00+08:00',
    recordedAt: '2026-08-12T10:42:00+08:00',
    closedAt: null,
    closedTradingDayKey: undefined,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    missReason: 'hesitation',
    mistakeTags: ['犹豫'],
    note: '<p>价格回踩确认后犹豫，没有执行预设挂单。</p>',
  })
  patchTrade(trades, 30, {
    ref: 'TRD-134',
    symbol: 'ETHUSDT',
    status: 'open',
    openedAt: '2026-08-12T08:45:00+08:00',
    closedAt: null,
    closedTradingDayKey: undefined,
    exit: null,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    reviewStatus: 'unreviewed',
    note: '<p>纽约盘前观察，风险已锁定为 0.6R。</p>',
  })
  patchTrade(trades, 31, {
    ref: 'TRD-135',
    symbol: 'BTCUSDT',
    status: 'open',
    openedAt: '2026-08-12T13:10:00+08:00',
    closedAt: null,
    closedTradingDayKey: undefined,
    exit: null,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    reviewStatus: 'unreviewed',
  })
  patchTrade(trades, 32, {
    ref: 'TRD-136',
    symbol: 'EURUSD',
    status: 'planned',
    openedAt: '2026-08-12T15:00:00+08:00',
    closedAt: null,
    closedTradingDayKey: undefined,
    exit: null,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    reviewStatus: 'unreviewed',
  })
  patchTrade(trades, 33, {
    ref: 'TRD-137',
    symbol: 'GBPUSD',
    status: 'missed',
    openedAt: '2026-08-11T17:30:00+08:00',
    recordedAt: '2026-08-11T17:45:00+08:00',
    closedAt: null,
    closedTradingDayKey: undefined,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    missReason: 'no_alert',
    reviewStatus: 'unreviewed',
  })

  const historicalSource = trades[20]
  const caseTemplate = trades[2]
  if (!historicalSource || !caseTemplate) {
    throw new Error('Desktop visual fixture is missing historical case sources')
  }
  trades.push(
    {
      ...caseTemplate,
      id: 'desktop-history-case-focus',
      ref: 'CASE-HISTORY-FOCUS',
      sourceTradeId: historicalSource.id,
      caseType: 'exemplar',
      masteryState: 'new',
      reviewStatus: 'focus',
      reviewCategory: 'focus',
      note: '<p>历史实盘重点案例：结构、时机与风险预算均符合计划。</p>',
    },
    {
      ...caseTemplate,
      id: 'desktop-history-case-mistake',
      ref: 'CASE-HISTORY-MISTAKE',
      sourceTradeId: historicalSource.id,
      caseType: 'mistake',
      masteryState: 'new',
      reviewStatus: 'unreviewed',
      reviewCategory: 'mistake',
      mistakeTags: ['提前进场'],
      note: '<p>历史实盘错题：确认完成前提前执行。</p>',
    },
    {
      ...caseTemplate,
      id: 'desktop-history-case-missed',
      ref: 'CASE-HISTORY-MISSED',
      sourceTradeId: historicalSource.id,
      caseType: 'missed',
      masteryState: 'new',
      reviewStatus: 'unreviewed',
      reviewCategory: 'normal',
      status: 'missed',
      pnl: null,
      rMultiple: null,
      resultSource: undefined,
      mistakeTags: ['犹豫'],
      note: '<p>历史实盘错过机会：信号出现后未执行计划。</p>',
    },
    {
      ...caseTemplate,
      id: 'desktop-history-case-recheck',
      ref: 'CASE-HISTORY-RECHECK',
      sourceTradeId: historicalSource.id,
      caseType: 'ambiguous',
      masteryState: 'recheck',
      reviewStatus: 'unreviewed',
      reviewCategory: 'recheck',
      note: '<p>历史实盘待复看案例：需要重新确认决策边界。</p>',
    },
    {
      ...caseTemplate,
      id: 'desktop-history-case-mastered',
      ref: 'CASE-HISTORY-MASTERED',
      sourceTradeId: historicalSource.id,
      caseType: 'exemplar',
      masteryState: 'mastered',
      reviewStatus: 'reviewed',
      reviewCategory: 'mastered',
      note: '<p>历史实盘已掌握案例：复盘结论已经稳定。</p>',
    },
  )

  return {
    ...snapshot,
    trades,
    starredIds: [trades[0].id, trades[2].id],
    display: {
      ...snapshot.display,
      tradingDayStartHour: 0,
      privacyMode: false,
      reviewContextPinned: true,
    },
    profile: {
      ...snapshot.profile,
      displayName: '桌面视觉样本',
    },
    livePerformanceCycles: [
      {
        id: 'desktop-visual-current',
        name: '当前实盘周期',
        startTradingDayKey: '2026-07-01',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    weeklyReviews: [
      {
        id: `weekly-review:${CURRENT_WEEK_START}`,
        weekStart: CURRENT_WEEK_START,
        weekEnd: '2026-08-16',
        status: 'draft',
        executionScore: 4,
        riskScore: 3,
        emotionScore: null,
        strengthTags: ['耐心等待'],
        mistakeTags: ['提前进场'],
        highlightTradeIds: [trades[0].id],
        mistakeTradeIds: [trades[1].id],
        followUpTradeIds: [trades[3].id],
        contentHtml: '<p>本周整体风险受控，主要问题是确认前提前进场。</p>',
        commitmentText: '只执行确认完成的交易机会',
        commitmentCriteria: '等待结构收线确认后再下单，否则放弃。',
        previousCommitmentResult: 'partial',
        metricsSnapshot: null,
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-12T12:00:00.000Z',
        completedAt: null,
      },
    ],
  }
}

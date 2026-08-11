import type { Trade, TradeKind, TradeResultSource, TradeStatus } from '@/data/trades'
import type { LiveArchiveScope } from '@/lib/liveStatisticsArchive'

export type PerformanceFixtureTrade = Trade

type Fact = {
  id: string
  tradeKind: TradeKind
  status: TradeStatus
  closedTradingDayKey?: string
  closedAt?: string | null
  pnl?: number | null
  rMultiple?: number | null
  resultSource?: TradeResultSource
  deletedAt?: string
  cashCurrency?: string | null
}

const hasOwn = (value: object, property: string): boolean => Object.prototype.hasOwnProperty.call(value, property)

function fact(input: Fact): PerformanceFixtureTrade {
  const trade: PerformanceFixtureTrade = {
    id: input.id,
    ref: input.id,
    symbol: 'BTCUSD',
    side: 'long',
    status: input.status,
    conviction: 'medium',
    strategyId: 'fixture',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: input.tradeKind,
    entry: 100,
    exit: 101,
    size: 1,
    pnl: input.pnl ?? null,
    rMultiple: input.rMultiple ?? null,
    resultSource: input.resultSource,
    // 测试必须证明平仓事实绝不以 openedAt 回退。
    openedAt: '2026-08-09T12:00:00+08:00',
    closedAt: input.closedAt ?? (input.closedTradingDayKey ? `${input.closedTradingDayKey}T12:00:00+08:00` : null),
    closedTradingDayKey: input.closedTradingDayKey,
    note: '',
    deletedAt: input.deletedAt,
  }
  if (hasOwn(input, 'cashCurrency')) trade.cashCurrency = input.cashCurrency
  return trade
}

const imported = (id: string, day: string, status: Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>, pnl: number, rMultiple: number): PerformanceFixtureTrade =>
  fact({ id, tradeKind: 'live', status, closedTradingDayKey: day, pnl, rMultiple, resultSource: 'imported' })

// 复制 ux-audit/seed-data.mjs 的 44 条最小稳定事实字段，移除 UI 展示噪声。
const auditSeeds: PerformanceFixtureTrade[] = [
  imported('tr-1001', '2026-06-04', 'win', 2135, 1.8),
  imported('tr-1002', '2026-06-05', 'loss', -58, -1.2),
  imported('tr-1003', '2026-06-09', 'win', 2153, 1.8),
  imported('tr-1004', '2026-06-11', 'win', 5, 1.8),
  imported('tr-1005', '2026-06-12', 'loss', -59, -1.2),
  imported('tr-1006', '2026-06-16', 'win', 2093, 1.8),
  imported('tr-1007', '2026-06-18', 'loss', -47, -1.2),
  imported('tr-1008', '2026-06-23', 'win', 6, 1.8),
  imported('tr-1009', '2026-06-25', 'breakeven', 0, 0),
  imported('tr-1010', '2026-06-29', 'win', 99, 1.8),
  imported('tr-1011', '2026-07-02', 'loss', -1206, -1.2),
  imported('tr-1012', '2026-07-03', 'win', 83, 1.8),
  imported('tr-1013', '2026-07-07', 'win', 2065, 1.8),
  imported('tr-1014', '2026-07-08', 'loss', -3, -1.2),
  imported('tr-1015', '2026-07-09', 'win', 101, 1.8),
  imported('tr-1016', '2026-07-13', 'loss', -1192, -1.2),
  imported('tr-1017', '2026-07-14', 'win', 83, 1.8),
  imported('tr-1018', '2026-07-16', 'win', 5, 1.8),
  imported('tr-1019', '2026-07-20', 'win', 2044, 1.8),
  imported('tr-1020', '2026-07-21', 'breakeven', 0, 0),
  imported('tr-1021', '2026-07-23', 'win', 2072, 1.8),
  imported('tr-1022', '2026-07-24', 'loss', -48, -1.2),
  imported('tr-1023', '2026-07-27', 'win', 5, 1.8),
  imported('tr-1024', '2026-07-29', 'win', 2016, 1.8),
  imported('tr-1025', '2026-07-30', 'loss', -57, -1.2),
  imported('tr-1026', '2026-07-31', 'win', 2009, 1.8),
  imported('tr-1027', '2026-08-03', 'win', 5, 1.8),
  imported('tr-1028', '2026-08-04', 'loss', -1144, -1.2),
  imported('tr-1029', '2026-08-05', 'win', 84, 1.8),
  fact({ id: 'tr-1030', tradeKind: 'live', status: 'win', closedTradingDayKey: '2026-08-06' }),
  imported('tr-1031', '2026-08-07', 'loss', -1136, -1.2),
  fact({ id: 'tr-1032', tradeKind: 'live', status: 'open' }),
  fact({ id: 'tr-1033', tradeKind: 'live', status: 'open' }),
  fact({ id: 'tr-1034', tradeKind: 'live', status: 'planned' }),
  fact({ id: 'tr-1035', tradeKind: 'live', status: 'missed' }),
  fact({ id: 'tr-1036', tradeKind: 'live', status: 'missed' }),
  fact({ id: 'case-1', tradeKind: 'case', status: 'win', closedTradingDayKey: '2026-06-04', pnl: 1800, rMultiple: 1.8, resultSource: 'imported' }),
  fact({ id: 'case-2', tradeKind: 'case', status: 'loss', closedTradingDayKey: '2026-06-05', pnl: -800, rMultiple: -1.2, resultSource: 'imported' }),
  fact({ id: 'case-3', tradeKind: 'case', status: 'win', closedTradingDayKey: '2026-06-11', pnl: 1800, rMultiple: 2.1, resultSource: 'imported' }),
  fact({ id: 'case-4', tradeKind: 'case', status: 'missed' }),
  fact({ id: 'case-5', tradeKind: 'case', status: 'loss', closedTradingDayKey: '2026-07-02', pnl: -700, rMultiple: -1, resultSource: 'imported' }),
  fact({ id: 'paper-1', tradeKind: 'paper', status: 'win', closedTradingDayKey: '2026-08-05', pnl: 600, rMultiple: 0.8, resultSource: 'imported' }),
  fact({ id: 'paper-2', tradeKind: 'paper', status: 'loss', closedTradingDayKey: '2026-08-07', pnl: -400, rMultiple: -1, resultSource: 'imported' }),
  fact({ id: 'trash-1', tradeKind: 'live', status: 'loss', closedTradingDayKey: '2026-06-02', pnl: -200, rMultiple: -0.4, resultSource: 'imported', deletedAt: '2026-08-01T20:00:00+08:00' }),
]

const edgeCases: PerformanceFixtureTrade[] = [
  fact({ id: 'FX-CLOSE-0559', tradeKind: 'live', status: 'win', closedAt: '2026-08-09T05:59:00+08:00', pnl: 1, rMultiple: 1, resultSource: 'imported' }),
  fact({ id: 'FX-CLOSE-0600', tradeKind: 'live', status: 'win', closedAt: '2026-08-09T06:00:00+08:00', pnl: 1, rMultiple: 1, resultSource: 'imported' }),
  fact({ id: 'FX-CLOSE-MISSING', tradeKind: 'live', status: 'win', pnl: 1, rMultiple: 1, resultSource: 'imported' }),
  fact({ id: 'FX-CLOSE-INVALID', tradeKind: 'live', status: 'win', closedAt: '2026-02-30T12:00:00+08:00', pnl: 1, rMultiple: 1, resultSource: 'imported' }),
  fact({ id: 'FX-CLOSE-FUTURE', tradeKind: 'live', status: 'win', closedTradingDayKey: '2026-08-10', pnl: 1, rMultiple: 1, resultSource: 'imported' }),
  fact({ id: 'FX-PAPER-MISSING', tradeKind: 'paper', status: 'win', pnl: 1, rMultiple: 1, resultSource: 'imported' }),
  fact({ id: 'FX-PNL-ONLY', tradeKind: 'live', status: 'win', closedTradingDayKey: '2026-08-09', pnl: 12, resultSource: 'pnl' }),
  fact({ id: 'FX-R-ONLY', tradeKind: 'live', status: 'loss', closedTradingDayKey: '2026-08-09', rMultiple: -1.2, resultSource: 'r' }),
  fact({ id: 'FX-CONFLICT', tradeKind: 'live', status: 'win', closedTradingDayKey: '2026-08-09', pnl: 12, rMultiple: -1.2, resultSource: 'imported' }),
  fact({ id: 'FX-USD', tradeKind: 'live', status: 'win', closedTradingDayKey: '2026-08-09', pnl: 100, rMultiple: 1, resultSource: 'imported', cashCurrency: 'USD' }),
  fact({ id: 'FX-CNY', tradeKind: 'live', status: 'win', closedTradingDayKey: '2026-08-09', pnl: 700, rMultiple: 1, resultSource: 'imported', cashCurrency: 'CNY' }),
  fact({ id: 'FX-CURRENCY-UNKNOWN', tradeKind: 'live', status: 'win', closedTradingDayKey: '2026-08-09', pnl: 10, rMultiple: 1, resultSource: 'imported', cashCurrency: null }),
]

export const performanceTruthFixture = {
  now: new Date('2026-08-09T12:00:00+08:00'),
  tradingDayStartHour: 6,
  currentLiveScope: {
    kind: 'current',
    archiveId: 'fixture-current',
    bounds: { startInclusive: '2026-07-01', endExclusive: null },
    label: '当前实盘',
  } satisfies LiveArchiveScope,
  trades: [...auditSeeds, ...edgeCases],
  expected: {
    futureCloseDayIds: ['FX-CLOSE-FUTURE'],
    missingCloseDayIds: ['FX-CLOSE-MISSING', 'FX-PAPER-MISSING'],
    invalidCloseDayIds: ['FX-CLOSE-INVALID'],
    completeResultIds: [
      'tr-1011', 'tr-1012', 'tr-1013', 'tr-1014', 'tr-1015', 'tr-1016', 'tr-1017', 'tr-1018', 'tr-1019', 'tr-1020', 'tr-1021', 'tr-1022', 'tr-1023', 'tr-1024', 'tr-1025', 'tr-1026', 'tr-1027', 'tr-1028', 'tr-1029', 'tr-1031', 'paper-1', 'paper-2', 'FX-CLOSE-0559', 'FX-CLOSE-0600', 'FX-PNL-ONLY', 'FX-R-ONLY', 'FX-USD', 'FX-CNY', 'FX-CURRENCY-UNKNOWN',
    ],
    conflictResultIds: ['FX-CONFLICT'],
    missingResultIds: ['tr-1030'],
    eligibleMetricIds: [
      'tr-1011', 'tr-1012', 'tr-1013', 'tr-1014', 'tr-1015', 'tr-1016', 'tr-1017', 'tr-1018', 'tr-1019', 'tr-1020', 'tr-1021', 'tr-1022', 'tr-1023', 'tr-1024', 'tr-1025', 'tr-1026', 'tr-1027', 'tr-1028', 'tr-1029', 'tr-1031', 'paper-1', 'paper-2', 'FX-CLOSE-0559', 'FX-CLOSE-0600', 'FX-PNL-ONLY', 'FX-R-ONLY', 'FX-USD', 'FX-CNY', 'FX-CURRENCY-UNKNOWN',
    ],
    pnlIds: [
      'tr-1011', 'tr-1012', 'tr-1013', 'tr-1014', 'tr-1015', 'tr-1016', 'tr-1017', 'tr-1018', 'tr-1019', 'tr-1020', 'tr-1021', 'tr-1022', 'tr-1023', 'tr-1024', 'tr-1025', 'tr-1026', 'tr-1027', 'tr-1028', 'tr-1029', 'tr-1031', 'paper-1', 'paper-2', 'FX-CLOSE-0559', 'FX-CLOSE-0600', 'FX-PNL-ONLY', 'FX-USD',
    ],
    rIds: [
      'tr-1011', 'tr-1012', 'tr-1013', 'tr-1014', 'tr-1015', 'tr-1016', 'tr-1017', 'tr-1018', 'tr-1019', 'tr-1020', 'tr-1021', 'tr-1022', 'tr-1023', 'tr-1024', 'tr-1025', 'tr-1026', 'tr-1027', 'tr-1028', 'tr-1029', 'tr-1031', 'paper-1', 'paper-2', 'FX-CLOSE-0559', 'FX-CLOSE-0600', 'FX-R-ONLY', 'FX-USD', 'FX-CNY', 'FX-CURRENCY-UNKNOWN',
    ],
    unknownCurrencyIds: [
      'FX-CURRENCY-UNKNOWN',
    ],
    currencyGroups: [
      {
        currency: 'USD',
        ids: [
          'tr-1011', 'tr-1012', 'tr-1013', 'tr-1014', 'tr-1015', 'tr-1016', 'tr-1017', 'tr-1018', 'tr-1019', 'tr-1020', 'tr-1021', 'tr-1022', 'tr-1023', 'tr-1024', 'tr-1025', 'tr-1026', 'tr-1027', 'tr-1028', 'tr-1029', 'tr-1031', 'paper-1', 'paper-2', 'FX-CLOSE-0559', 'FX-CLOSE-0600', 'FX-PNL-ONLY', 'FX-USD',
        ],
      },
      { currency: 'CNY', ids: ['FX-CNY'] },
    ],
  },
} as const

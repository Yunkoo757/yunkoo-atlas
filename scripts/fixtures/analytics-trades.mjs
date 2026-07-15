import { createHash } from 'node:crypto'

export const ANALYTICS_FIXTURE_SEED = 20_260_715

export const ANALYTICS_FIXTURE_STRATEGIES = Object.freeze([
  { id: 'fixture-strategy-1', name: '趋势延续', icon: 'trending-up', color: '#5e6ad2' },
  { id: 'fixture-strategy-2', name: '均值回归', icon: 'arrow-left-right', color: '#27ae60' },
  { id: 'fixture-strategy-3', name: '突破确认', icon: 'zap', color: '#f2994a' },
  { id: 'fixture-strategy-4', name: '事件驱动', icon: 'newspaper', color: '#bb6bd9' },
])

function mulberry32(seed) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296
  }
}

function isoAt(dayOffset, hourOffset = 0) {
  const value = Date.UTC(2026, 6, 14 - dayOffset, 8 + hourOffset, 0, 0)
  return new Date(value).toISOString()
}

function createFixtureNote(index, noteProfile) {
  const image = index % 97 === 0
    ? `<img src="journal-asset://fixture-asset-${String(index + 1).padStart(5, '0')}">`
    : ''
  const prefix = `<p>固定分析样本 ${index + 1} · `
  const suffix = `</p>${image}`
  if (noteProfile === 'short') return `${prefix}短笔记${suffix}`

  const targetBytes = 2_048
  const fixedBytes = Buffer.byteLength(prefix + suffix, 'utf8')
  return `${prefix}${'x'.repeat(Math.max(0, targetBytes - fixedBytes))}${suffix}`
}

export function createAnalyticsTrades({
  count = 1_000,
  seed = ANALYTICS_FIXTURE_SEED,
  noteProfile = 'short',
} = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError('count must be a positive integer')
  }
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer')
  if (noteProfile !== 'short' && noteProfile !== '2kb') {
    throw new TypeError("noteProfile must be 'short' or '2kb'")
  }

  const random = mulberry32(seed)
  const symbols = ['BTCUSDT', 'EURUSD', 'XAUUSD', 'ETHUSDT', 'GBPUSD', 'SOLUSDT']
  const trades = Array.from({ length: count }, (_, index) => {
    const rMultiple = Math.round((random() * 5 - 1.8) * 100) / 100
    const status = rMultiple > 0 ? 'win' : rMultiple < 0 ? 'loss' : 'breakeven'
    const openedAt = isoAt(index % 720, -(index % 6))
    return {
      id: `fixture-${seed}-${String(index + 1).padStart(5, '0')}`,
      ref: `FXT-${String(index + 1).padStart(5, '0')}`,
      symbol: symbols[index % symbols.length],
      side: index % 2 === 0 ? 'long' : 'short',
      status,
      conviction: ['low', 'medium', 'high', 'urgent'][index % 4],
      strategyId: `fixture-strategy-${(index % 4) + 1}`,
      session: ['亚洲', '伦敦', '纽约'][index % 3],
      timeframe: ['15M', '1H', '4H', '1D'][index % 4],
      tags: index % 5 === 0 ? ['趋势延续'] : [],
      mistakeTags: [],
      reviewStatus: index % 3 === 0 ? 'reviewed' : 'unreviewed',
      reviewCategory: 'normal',
      tradeKind: 'live',
      entry: 100 + index / 10,
      exit: 100 + index / 10 + rMultiple,
      size: 1 + (index % 5),
      pnl: Math.round(rMultiple * 100 * 100) / 100,
      rMultiple,
      resultSource: 'imported',
      openedAt,
      closedAt: isoAt(index % 720, 0),
      note: createFixtureNote(index, noteProfile),
    }
  })

  const patch = (index, values) => {
    if (trades[index]) trades[index] = { ...trades[index], ...values }
  }
  patch(1, { tradeKind: 'paper' })
  patch(2, { tradeKind: 'case' })
  patch(3, {
    status: 'missed',
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    closedAt: null,
  })
  patch(4, { deletedAt: isoAt(1) })
  patch(5, {
    status: 'win',
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
  })
  patch(6, { status: 'breakeven', pnl: 0, rMultiple: 0, resultSource: 'imported' })
  patch(7, { status: 'win', pnl: 125, rMultiple: -1.25, resultSource: 'imported' })
  patch(8, { status: 'loss', pnl: -425, rMultiple: -4.25, resultSource: 'imported' })
  patch(9, { status: 'win', pnl: 1_250, rMultiple: 12.5, resultSource: 'imported' })

  return trades
}

export function checksumFixture(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function createAnalyticsSnapshot(options = {}) {
  const trades = createAnalyticsTrades(options)
  return {
    trades,
    strategies: ANALYTICS_FIXTURE_STRATEGIES.map((strategy) => ({ ...strategy })),
    starredIds: trades.slice(0, 8).map((trade) => trade.id),
    subscribedIds: [],
    pinnedStrategyIds: ANALYTICS_FIXTURE_STRATEGIES.slice(0, 2).map((strategy) => strategy.id),
    display: {
      hideClosed: false,
      showEmptyGroups: false,
      groupByStrategy: false,
      groupByDate: true,
      sortBy: 'date',
      sidebarPins: [],
      sidebarWorkspaceItems: [],
    },
    tagPresets: ['趋势延续', '流动性扫盘'],
    mistakeTagPresets: ['追单', '止损移动'],
    profile: { avatarId: null, displayName: 'Fixture' },
    savedTradeViews: [],
    symbolIcons: {},
    symbolCatalog: [...new Set(trades.map((trade) => trade.symbol))],
  }
}

function sign(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.sign(value) : null
}

export function inspectAnalyticsFixture(trades) {
  return trades.reduce(
    (coverage, trade) => {
      if (trade.tradeKind === 'live') coverage.live += 1
      if (trade.tradeKind === 'paper') coverage.paper += 1
      if (trade.tradeKind === 'case') coverage.case += 1
      if (trade.status === 'missed') coverage.missed += 1
      if (trade.deletedAt) coverage.deleted += 1
      if (trade.pnl == null && trade.rMultiple == null) coverage.nullResult += 1
      if (trade.status === 'breakeven' && trade.pnl === 0 && trade.rMultiple === 0) {
        coverage.breakeven += 1
      }
      const pnlSign = sign(trade.pnl)
      const rSign = sign(trade.rMultiple)
      const statusSign = trade.status === 'win' ? 1 : trade.status === 'loss' ? -1 : trade.status === 'breakeven' ? 0 : null
      if (
        (pnlSign !== null && rSign !== null && pnlSign !== rSign) ||
        (statusSign !== null && pnlSign !== null && statusSign !== pnlSign) ||
        (statusSign !== null && rSign !== null && statusSign !== rSign)
      ) {
        coverage.resultConflict += 1
      }
      if (typeof trade.rMultiple === 'number' && trade.rMultiple < -3) coverage.belowMinus3R += 1
      if (typeof trade.rMultiple === 'number' && trade.rMultiple > 10) coverage.above10R += 1
      return coverage
    },
    {
      live: 0,
      paper: 0,
      case: 0,
      missed: 0,
      deleted: 0,
      nullResult: 0,
      breakeven: 0,
      resultConflict: 0,
      belowMinus3R: 0,
      above10R: 0,
    },
  )
}

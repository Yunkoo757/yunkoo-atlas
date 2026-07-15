import type { Strategy, StrategyVersion } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { bindTradeStrategyVersions, ensureStrategyVersionGraph } from '@/lib/strategies'
import { applyTradeUpsertsToSlice } from '@/store/useStore'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const strategy: Strategy = {
  id: 'breakout',
  name: '突破',
  icon: 'trending-up',
  color: '#5e6ad2',
  reviewTemplateHtml: '<p>复盘模板</p>',
}

export function testMissingStrategyVersionBecomesDeterministicV1(): void {
  const first = ensureStrategyVersionGraph([strategy])
  const second = ensureStrategyVersionGraph([strategy])

  assert(first.strategies[0]?.currentVersionId === 'breakout:v1', 'strategy should bind v1')
  assert(first.strategyVersions[0]?.createdAt === null, 'legacy v1 must not invent creation time')
  assert(
    first.strategyVersions[0]?.reviewTemplateHtml === '<p>复盘模板</p>',
    'legacy review template must remain authoritative in v1',
  )
  assert(JSON.stringify(first) === JSON.stringify(second), 'v1 generation must be deterministic')
}

export function testValidExistingStrategyVersionIsPreserved(): void {
  const version: StrategyVersion = {
    id: 'breakout:v2',
    strategyId: 'breakout',
    version: 2,
    label: 'v2',
    createdAt: '2026-07-16T00:00:00.000Z',
  }
  const graph = ensureStrategyVersionGraph(
    [{ ...strategy, currentVersionId: version.id }],
    [version],
  )

  assert(graph.strategyVersions.length === 1, 'valid versions must not create duplicate v1')
  assert(graph.strategies[0]?.currentVersionId === version.id, 'current version must be preserved')
}

export function testTradesBindTheirStrategyCurrentVersion(): void {
  const graph = ensureStrategyVersionGraph([strategy])
  const trade = {
    id: 'trade-1',
    strategyId: strategy.id,
  } as Trade
  const [bound] = bindTradeStrategyVersions([trade], graph.strategies)

  assert(bound?.strategyVersionId === 'breakout:v1', 'trade should bind its strategy version')
}

export function testNewTradeUpsertMakesUnknownEvidenceExplicit(): void {
  const graph = ensureStrategyVersionGraph([strategy])
  const trade: Trade = {
    id: 'trade-new',
    ref: 'TRD-new',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'open',
    conviction: 'medium',
    strategyId: strategy.id,
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: null,
    exit: null,
    size: null,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-16',
    closedAt: null,
    note: '',
  }
  const result = applyTradeUpsertsToSlice({
    trades: [],
    strategies: graph.strategies,
    symbolCatalog: [],
    tagPresets: [],
    mistakeTagPresets: [],
  }, [trade])
  const saved = result.trades[0]!

  assert(saved.strategyVersionId === 'breakout:v1', 'new trade must bind the active strategy version')
  assert(saved.pnlBasis === 'unknown', 'missing PnL basis must remain explicitly unknown')
  assert(saved.pnlCurrency === null && saved.pnlCurrencySource === null, 'missing money must not invent a currency')
  assert(saved.openedAtTimestamp === null && saved.closedAtTimestamp === null, 'business dates must not invent timestamps')
}

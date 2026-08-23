export const PAGE_OWNED_TRADE_VIEW_PARAMS = new Set(['liveStage', 'tab', 'sources'])

export const KNOWN_TRADE_VIEW_PARAMS = new Set([
  'tradeKind',
  'period',
  'strategyId',
  'symbol',
  'side',
  'status',
  'session',
  'tag',
  'mistakeTag',
  'reviewCategory',
  'caseType',
  'masteryState',
  'kind',
  'range',
  'liveCycle',
  'statsCycle',
  'view',
  'caseScope',
  'archiveReason',
  'requestedKey',
  ...PAGE_OWNED_TRADE_VIEW_PARAMS,
])

export function isKnownTradeViewParam(key: string): boolean {
  return KNOWN_TRADE_VIEW_PARAMS.has(key)
}

export function preservePageOwnedSearch(
  search: URLSearchParams,
  extras: { historicalLiveScope?: 'trades' | 'cases' | null } = {},
): URLSearchParams {
  const next = new URLSearchParams()
  for (const key of PAGE_OWNED_TRADE_VIEW_PARAMS) {
    const value = search.get(key)
    if (value) next.set(key, value)
  }
  if (extras.historicalLiveScope === 'cases' && !next.get('tab')) {
    next.set('tab', 'cases')
  }
  return next
}

import {
  KNOWN_TRADE_VIEW_PARAMS,
  PAGE_OWNED_TRADE_VIEW_PARAMS,
  isKnownTradeViewParam,
  preservePageOwnedSearch,
} from '@/lib/tradeViewParams'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testLiveStageAndTabArePageOwnedNotUnknownFilters(): void {
  assert(PAGE_OWNED_TRADE_VIEW_PARAMS.has('liveStage'), 'liveStage 必须是历史实盘页面自有参数')
  assert(PAGE_OWNED_TRADE_VIEW_PARAMS.has('tab'), 'tab 必须是历史实盘页面自有参数')
  assert(PAGE_OWNED_TRADE_VIEW_PARAMS.has('sources'), 'sources 必须是策略页自有参数')
  assert(isKnownTradeViewParam('liveStage'), '页面自有参数不得生成未知筛选标签')
  assert(isKnownTradeViewParam('tab'), '页面自有参数不得生成未知筛选标签')
  assert(isKnownTradeViewParam('sources'), '策略来源不得生成未支持的筛选标签')
  assert(!PAGE_OWNED_TRADE_VIEW_PARAMS.has('status'), 'status 仍是交易筛选，不是页面路由状态')
  assert(isKnownTradeViewParam('status'), '已知交易筛选仍算已知参数')
  assert(!isKnownTradeViewParam('notARealFilter'), '真正未知参数必须仍可被标成未支持')
}

export function testClearingTradeFiltersKeepsHistoricalStageAndTab(): void {
  const current = new URLSearchParams('liveStage=stage-2&tab=live&status=loss&symbol=BTCUSDT&sources=trade,case')
  const next = preservePageOwnedSearch(current, { historicalLiveScope: 'trades' })
  assert(next.get('liveStage') === 'stage-2', '清除交易筛选必须保留当前历史阶段')
  assert(next.get('tab') === 'live', '清除交易筛选必须保留当前标签页')
  assert(next.get('sources') === 'trade,case', '清除交易筛选必须保留策略来源')
  assert(next.get('status') === null, '清除交易筛选必须去掉 status')
  assert(next.get('symbol') === null, '清除交易筛选必须去掉 symbol')
}

export function testClearingHistoricalCaseFiltersKeepsTabCases(): void {
  const current = new URLSearchParams('liveStage=stage-2&tab=cases&caseScope=mistakes')
  const next = preservePageOwnedSearch(current, { historicalLiveScope: 'cases' })
  assert(next.get('liveStage') === 'stage-2', '案例标签页清除筛选也必须保留阶段')
  assert(next.get('tab') === 'cases', '案例标签页清除筛选必须保留 tab=cases')
  assert(next.get('caseScope') === null, '案例范围属于交易筛选，应被清除')
}

export function testKnownTradeViewParamsKeepLegacyFacets(): void {
  for (const key of [
    'tradeKind', 'period', 'strategyId', 'symbol', 'side', 'status', 'session',
    'tag', 'mistakeTag', 'reviewCategory', 'caseType', 'masteryState', 'kind',
    'range', 'liveCycle', 'statsCycle', 'view', 'caseScope', 'archiveReason',
    'requestedKey', 'liveStage', 'tab', 'sources',
  ]) {
    assert(KNOWN_TRADE_VIEW_PARAMS.has(key), `已知参数表缺少 ${key}`)
  }
}

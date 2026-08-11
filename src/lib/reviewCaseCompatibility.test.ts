import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { getWorkbenchVisibleTrades } from '@/lib/workbenchTrades'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const baseCase: Trade = {
  id: 'case-base',
  ref: 'CAS-BASE',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  tradeKind: 'case',
  caseType: 'exemplar',
  masteryState: 'new',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 10,
  rMultiple: 1,
  resultSource: 'imported',
  openedAt: '2026-08-01T08:00:00.000Z',
  closedAt: '2026-08-01T09:00:00.000Z',
  note: '',
}

export function testLegacyFocusQueryMatchesStarredAndUntouchedLegacyCases(): void {
  const starredNormalized = { ...baseCase, id: 'case-starred', ref: 'CAS-STARRED' }
  const untouchedLegacy = {
    ...baseCase,
    id: 'case-legacy-focus',
    ref: 'CAS-LEGACY-FOCUS',
    reviewCategory: 'focus' as const,
  }
  const ordinary = { ...baseCase, id: 'case-ordinary', ref: 'CAS-ORDINARY' }

  const visible = getWorkbenchVisibleTrades({
    trades: [starredNormalized, untouchedLegacy, ordinary],
    filter: { type: 'all', tradeKind: 'case', reviewCaseScope: 'all' },
    starredIds: [starredNormalized.id],
    display: DEFAULT_DISPLAY,
    search: '?reviewCategory=focus',
  })

  assert(
    visible.map((trade) => trade.id).sort().join(',') ===
      'case-legacy-focus,case-starred',
    'legacy focus 查询必须同时命中已星标规范案例与尚未迁移的 focus 案例',
  )
}

export function testLegacyFocusCompatibilityDoesNotRewriteAccountTradeCategories(): void {
  const starredNormalTrade: Trade = {
    ...baseCase,
    id: 'live-starred-normal',
    ref: 'TRD-STARRED-NORMAL',
    tradeKind: 'live',
    caseType: undefined,
    masteryState: undefined,
  }
  const exactFocusTrade: Trade = {
    ...starredNormalTrade,
    id: 'live-exact-focus',
    ref: 'TRD-EXACT-FOCUS',
    reviewCategory: 'focus',
  }

  const visible = getWorkbenchVisibleTrades({
    trades: [starredNormalTrade, exactFocusTrade],
    filter: { type: 'all', tradeKind: 'live' },
    starredIds: [starredNormalTrade.id],
    display: DEFAULT_DISPLAY,
    search: '?reviewCategory=focus',
  })

  assert(
    visible.length === 1 && visible[0]?.id === exactFocusTrade.id,
    '账户交易的 reviewCategory=focus 必须继续精确匹配，不得把星标解释为分类',
  )
}

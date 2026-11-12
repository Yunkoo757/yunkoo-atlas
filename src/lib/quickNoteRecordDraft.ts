import { DEFAULT_TIMEFRAME, type Trade, type TradeKind } from '@/data/trades'
import type { QuickNote } from '@/data/quickNotes'
import { addDaysToCurrentTradingDay, DEFAULT_TRADING_DAY_START_HOUR } from '@/lib/periods'
import { applyCaseClassificationMutation } from '@/lib/reviewCaseClassification'

export function getNextTradeRef(
  trades: readonly { ref: string }[],
  kind: TradeKind,
): string {
  const prefix = kind === 'case' ? 'CAS' : 'TRD'
  const maxNum = trades.reduce((max, item) => {
    const match = item.ref.match(new RegExp(`^${prefix}-(\\d+)$`))
    return match ? Math.max(max, Number.parseInt(match[1], 10)) : max
  }, 0)
  return `${prefix}-${maxNum + 1}`
}

export function buildQuickNoteRecord(input: {
  note: QuickNote
  kind: 'live' | 'case'
  id: string
  ref: string
  strategyId: string
  symbol: string
  liveStageId: string | null
  now?: Date
  tradingDayStartHour?: number
}): Trade {
  const now = input.now ?? new Date()
  const tradingDayStartHour = input.tradingDayStartHour ?? DEFAULT_TRADING_DAY_START_HOUR
  const openedAt = now.toISOString().slice(0, 10)
  const symbol = input.symbol.trim().toUpperCase() || 'NOTE'
  const candidate: Trade = {
    id: input.id,
    ref: input.ref,
    symbol,
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    tradeKind: input.kind,
    liveStageId: input.liveStageId,
    strategyId: input.strategyId,
    timeframe: DEFAULT_TIMEFRAME,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    ...(input.kind === 'case' ? { masteryState: 'new' as const, nextReviewAt: addDaysToCurrentTradingDay(now, tradingDayStartHour, 3) } : {}),
    entry: 0,
    exit: null,
    size: 0,
    pnl: null,
    rMultiple: null,
    openedAt,
    recordedAt: now.toISOString(),
    closedAt: null,
    note: input.note.contentHtml,
  }
  if (candidate.tradeKind !== 'case') return candidate
  const classified = applyCaseClassificationMutation(candidate, { caseType: 'exemplar' })
  if (!classified.ok) throw new Error('无法创建案例草稿')
  return classified.trade
}

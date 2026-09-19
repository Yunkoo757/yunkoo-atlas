import { DEFAULT_TIMEFRAME, type Trade, type TradeSide } from '@/data/trades'
import { addDaysToCurrentTradingDay, DEFAULT_TRADING_DAY_START_HOUR } from '@/lib/periods'
import { applyCaseClassificationMutation } from '@/lib/reviewCaseClassification'

export function composerTextToNoteHtml(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return trimmed.split(/\n{2,}/).map((block) => {
    const escaped = block
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>')
    return `<p>${escaped}</p>`
  }).join('')
}

export function composerSideFromState(value: string): TradeSide {
  return value === 'short' ? 'short' : 'long'
}

export function buildComposerReviewCase(input: {
  id: string
  ref: string
  symbol: string
  side: string
  strategyId: string
  openedAt: string
  noteHtml: string
  liveStageId: string | null
  now?: Date
  tradingDayStartHour?: number
}): Trade {
  const now = input.now ?? new Date()
  const tradingDayStartHour = input.tradingDayStartHour ?? DEFAULT_TRADING_DAY_START_HOUR
  const candidate: Trade = {
    id: input.id,
    ref: input.ref,
    symbol: input.symbol.trim().toUpperCase() || 'CASE',
    side: composerSideFromState(input.side),
    status: 'planned',
    conviction: 'medium',
    tradeKind: 'case',
    liveStageId: input.liveStageId,
    strategyId: input.strategyId,
    timeframe: DEFAULT_TIMEFRAME,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    masteryState: 'new',
    nextReviewAt: addDaysToCurrentTradingDay(now, tradingDayStartHour, 3),
    entry: 0,
    exit: null,
    size: 0,
    pnl: null,
    rMultiple: null,
    openedAt: input.openedAt,
    recordedAt: now.toISOString(),
    closedAt: null,
    note: input.noteHtml,
  }
  const classified = applyCaseClassificationMutation(candidate, { caseType: 'exemplar' })
  if (!classified.ok) throw new Error('无法创建案例草稿')
  return classified.trade
}

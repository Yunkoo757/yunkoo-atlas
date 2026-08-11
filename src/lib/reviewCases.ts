import type { CaseType, Trade } from '@/data/trades'
import {
  addDaysToCurrentTradingDay,
  DEFAULT_TRADING_DAY_START_HOUR,
} from '@/lib/periods'
import { applyCaseClassificationMutation } from '@/lib/reviewCaseClassification'

export function getNextReviewCaseRef(trades: Trade[]): string {
  const maxNum = trades.reduce((max, trade) => {
    const match = trade.ref.match(/^CAS-(\d+)$/)
    return match ? Math.max(max, parseInt(match[1], 10)) : max
  }, 0)
  return `CAS-${maxNum + 1}`
}

export function buildReviewCaseFromTrade(
  source: Trade,
  options: {
    id: string
    ref: string
    now?: Date
    tradingDayStartHour?: number
  },
): Trade {
  const { deletedAt: _deletedAt, deletedBy: _deletedBy, ...activeSource } = source
  const caseType: CaseType =
    source.status === 'missed'
      ? 'missed'
      : source.reviewCategory === 'ambiguous'
        ? 'ambiguous'
        : source.mistakeTags.length > 0 || source.reviewCategory === 'mistake'
          ? 'mistake'
          : 'exemplar'
  const now = options.now ?? new Date()
  const tradingDayStartHour = options.tradingDayStartHour ?? DEFAULT_TRADING_DAY_START_HOUR

  const baseCase: Trade = {
    ...activeSource,
    id: options.id,
    ref: options.ref,
    tradeKind: 'case',
    sourceTradeId: source.id,
    sourceNoteHtml: source.note,
    caseType: undefined,
    masteryState: 'new',
    nextReviewAt: addDaysToCurrentTradingDay(now, tradingDayStartHour, 3),
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    recordedAt: now.toISOString(),
    note: '',
    comments: [],
    activities: [],
  }
  const classified = applyCaseClassificationMutation(baseCase, { caseType })
  return classified.trade
}

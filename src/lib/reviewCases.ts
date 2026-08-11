import type { CaseType, Trade } from '@/data/trades'
import { formatYmd } from '@/lib/periods'
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
  options: { id: string; ref: string },
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
  const nextReview = new Date()
  nextReview.setDate(nextReview.getDate() + 3)

  const baseCase: Trade = {
    ...activeSource,
    id: options.id,
    ref: options.ref,
    tradeKind: 'case',
    sourceTradeId: source.id,
    sourceNoteHtml: source.note,
    caseType: undefined,
    masteryState: 'new',
    nextReviewAt: formatYmd(nextReview),
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    recordedAt: new Date().toISOString(),
    note: '',
    comments: [],
    activities: [],
  }
  const classified = applyCaseClassificationMutation(baseCase, { caseType })
  return classified.trade
}

import type { Trade } from '@/data/trades'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

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
  const sourceLine = `<p>来源交易：${escapeHtml(source.ref)} · ${escapeHtml(source.symbol)}</p>`
  const note = [sourceLine, source.note].filter(Boolean).join('\n')
  const { deletedAt: _deletedAt, deletedBy: _deletedBy, ...activeSource } = source

  return {
    ...activeSource,
    id: options.id,
    ref: options.ref,
    tradeKind: 'case',
    recordedAt: new Date().toISOString(),
    note,
    comments: [],
    activities: [],
  }
}

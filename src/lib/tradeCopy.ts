import type { Trade } from '@/data/trades'
import { formatYmd } from '@/lib/periods'

export interface SafeTradeCopyOptions {
  now: Date
  createId: () => string
}

function getMaxRefNumber(trades: readonly Trade[], prefix: 'TRD' | 'CAS'): number {
  return trades.reduce((max, trade) => {
    const match = trade.ref.match(new RegExp(`^${prefix}-(\\d+)$`))
    return match ? Math.max(max, Number.parseInt(match[1]!, 10)) : max
  }, 0)
}

function copyAccountTrade(
  source: Trade,
  id: string,
  ref: string,
  now: Date,
): Trade {
  return {
    ...source,
    id,
    ref,
    status: 'planned',
    tradeKind: source.tradeKind,
    tags: [...source.tags],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewedAt: null,
    reviewCategory: 'normal',
    sourceTradeId: undefined,
    caseType: undefined,
    masteryState: undefined,
    nextReviewAt: undefined,
    exit: null,
    initialStopLoss: null,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    openedAt: formatYmd(now),
    recordedAt: now.toISOString(),
    closedAt: null,
    missReason: undefined,
    note: '',
    comments: [],
    activities: [],
    deletedAt: undefined,
    deletedBy: undefined,
  }
}

function copyReviewCase(
  source: Trade,
  id: string,
  ref: string,
  now: Date,
): Trade {
  return {
    ...source,
    id,
    ref,
    tradeKind: 'case',
    sourceTradeId: source.sourceTradeId,
    tags: [...source.tags],
    mistakeTags: [...source.mistakeTags],
    reviewStatus: 'unreviewed',
    reviewedAt: null,
    reviewCategory: source.reviewCategory,
    masteryState: 'new',
    nextReviewAt: null,
    recordedAt: now.toISOString(),
    comments: [],
    activities: [],
    deletedAt: undefined,
    deletedBy: undefined,
  }
}

/**
 * 从现有记录批量创建安全副本。
 *
 * 账户交易只复制为新的计划，不继承历史结果；案例保持案例身份，因此不会进入账户绩效统计。
 */
export function buildSafeTradeCopies(
  sources: readonly Trade[],
  allTrades: readonly Trade[],
  options: SafeTradeCopyOptions,
): Trade[] {
  let nextTradeNumber = getMaxRefNumber(allTrades, 'TRD') + 1
  let nextCaseNumber = getMaxRefNumber(allTrades, 'CAS') + 1
  const allocatedIds = new Set(allTrades.map((trade) => trade.id))

  return sources.map((source) => {
    const id = options.createId()
    if (!id || allocatedIds.has(id)) {
      throw new Error('无法创建安全副本：生成的记录 ID 无效或重复')
    }
    allocatedIds.add(id)
    if (source.tradeKind === 'case') {
      return copyReviewCase(source, id, `CAS-${nextCaseNumber++}`, options.now)
    }
    return copyAccountTrade(source, id, `TRD-${nextTradeNumber++}`, options.now)
  })
}

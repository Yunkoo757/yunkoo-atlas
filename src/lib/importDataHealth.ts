import type { TradeStatus } from '@/data/trades'
import { openedTradingDayKey } from '@/lib/liveCycle'
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
import { isExecutedClosed } from '@/lib/tradeStatus'
import type { PersistedSnapshot, PersistedTrade } from '@/storage/types'

export type CopiedCloseDateConfidence = 'high' | 'manual-review'

export interface CopiedCloseDateCandidate {
  tradeId: string
  ref: string
  symbol: string
  source: 'Notion'
  openedAt: string
  closedAt: string
  result: string
  evidence: string
  confidence: CopiedCloseDateConfidence
  selectedByDefault: boolean
}

const RESULT_LABELS: Partial<Record<TradeStatus, string>> = {
  win: '盈利',
  loss: '亏损',
  breakeven: '保本',
}

function hasWeakNotionEvidence(trade: PersistedTrade): boolean {
  return trade.importProvenance?.source === 'notion' || trade.tags.includes('notion-import')
}

function isSameLegalBusinessDay(trade: PersistedTrade, tradingDayStartHour: number): trade is PersistedTrade & { closedAt: string } {
  const openedDay = openedTradingDayKey(trade, tradingDayStartHour)
  const closedDay = closedTradingDayKeyFromClosedAt(trade.closedAt, tradingDayStartHour)
  return openedDay !== null && closedDay !== null && openedDay === closedDay
}

function candidateForTrade(
  trade: PersistedTrade,
  tradingDayStartHour: number,
): CopiedCloseDateCandidate | null {
  if (
    trade.tradeKind !== 'live' ||
    trade.deletedAt !== undefined ||
    !isExecutedClosed(trade.status) ||
    !hasWeakNotionEvidence(trade) ||
    !isSameLegalBusinessDay(trade, tradingDayStartHour)
  ) return null

  const highConfidence = trade.importProvenance?.source === 'notion'
    && trade.importProvenance.openedAtSource === 'notion-date'
    && trade.importProvenance.closedAtSource === 'missing-in-source'
  return {
    tradeId: trade.id,
    ref: trade.ref,
    symbol: trade.symbol,
    source: 'Notion',
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    result: RESULT_LABELS[trade.status] ?? trade.status,
    evidence: highConfidence
      ? '来源元数据明确：Notion 仅提供开仓日期，未提供平仓日期'
      : trade.importProvenance?.closedAtSource === 'notion-close-date'
        ? '来源包含真实平仓日期；同日开平需人工确认，不会自动选择'
        : '仅有旧版 Notion 标签，缺少日期字段来源证据，需人工核对',
    confidence: highConfidence ? 'high' : 'manual-review',
    selectedByDefault: highConfidence,
  }
}

export function buildCopiedCloseDateCandidates(
  trades: readonly PersistedTrade[],
  tradingDayStartHour: number,
): CopiedCloseDateCandidate[] {
  return trades
    .map((trade) => candidateForTrade(trade, tradingDayStartHour))
    .filter((candidate): candidate is CopiedCloseDateCandidate => candidate !== null)
    .sort((left, right) => {
      if (left.confidence !== right.confidence) return left.confidence === 'high' ? -1 : 1
      return left.ref.localeCompare(right.ref)
    })
}

export interface CommitCopiedCloseDateCleanupInput {
  tradeIds: readonly string[]
  tradingDayStartHour: number
  captureLatest: () => { trades: readonly PersistedTrade[]; snapshot: PersistedSnapshot }
  persistSnapshot: (snapshot: PersistedSnapshot) => Promise<void>
  publish: (trades: PersistedTrade[]) => void
}

export type CommitCopiedCloseDateCleanupResult =
  | {
      kind: 'committed'
      before: PersistedTrade[]
      after: PersistedTrade[]
      trades: PersistedTrade[]
    }
  | { kind: 'stale-selection' }

/**
 * 清理提交内核：确认后的最新候选重新校验，通过持久化边界后才发布内存状态。
 */
export async function commitCopiedCloseDateCleanup(
  input: CommitCopiedCloseDateCleanupInput,
): Promise<CommitCopiedCloseDateCleanupResult> {
  const uniqueIds = [...new Set(input.tradeIds)]
  if (uniqueIds.length === 0) return { kind: 'stale-selection' }
  const baseline = input.captureLatest()
  const candidates = new Set(
    buildCopiedCloseDateCandidates(baseline.trades, input.tradingDayStartHour)
      .map((candidate) => candidate.tradeId),
  )
  if (uniqueIds.some((id) => !candidates.has(id))) return { kind: 'stale-selection' }

  const selectedIds = new Set(uniqueIds)
  const before = baseline.trades.filter((trade) => selectedIds.has(trade.id)).map((trade) => ({ ...trade }))
  const after = before.map((trade) => {
    const cleaned = { ...trade, closedAt: null }
    delete cleaned.closedTradingDayKey
    return cleaned
  })
  const afterById = new Map(after.map((trade) => [trade.id, trade]))
  const trades = baseline.trades.map((trade) => afterById.get(trade.id) ?? trade)
  const nextSnapshot: PersistedSnapshot = { ...baseline.snapshot, trades }

  await input.persistSnapshot(nextSnapshot)
  input.publish(trades)
  return { kind: 'committed', before, after, trades }
}

export interface CopiedCloseDatePersistenceBoundary {
  lockInteraction: () => () => void
  flushBeforeCommit: () => Promise<void>
  suspendPersist: () => void
  resumePersist: () => void
  discardPendingAndResumePersist: () => void
}

export async function commitCopiedCloseDateCleanupThroughBoundary(input: {
  cleanup: CommitCopiedCloseDateCleanupInput
  boundary: CopiedCloseDatePersistenceBoundary
}): Promise<CommitCopiedCloseDateCleanupResult> {
  const unlockInteraction = input.boundary.lockInteraction()
  let suspended = false
  let durablyCommitted = false
  try {
    await input.boundary.flushBeforeCommit()
    input.boundary.suspendPersist()
    suspended = true
    const persistSnapshot = input.cleanup.persistSnapshot
    const result = await commitCopiedCloseDateCleanup({
      ...input.cleanup,
      persistSnapshot: async (snapshot) => {
        await persistSnapshot(snapshot)
        durablyCommitted = true
      },
    })
    if (durablyCommitted) input.boundary.discardPendingAndResumePersist()
    else input.boundary.resumePersist()
    suspended = false
    return result
  } finally {
    if (suspended) {
      if (durablyCommitted) input.boundary.discardPendingAndResumePersist()
      else input.boundary.resumePersist()
    }
    unlockInteraction()
  }
}

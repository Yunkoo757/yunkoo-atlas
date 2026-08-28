import type { CaseType, MasteryState, Trade } from '@/data/trades'

export interface CaseClassificationMutation extends Record<string, unknown> {
  caseType?: CaseType
  masteryState?: MasteryState
  nextReviewAt?: string | null | undefined
}

export type CaseClassificationMutationResult =
  | {
      ok: true
      changed: boolean
      trade: Trade
      promoteLegacyFocusToStar: boolean
    }
  | {
      ok: false
      code: 'review-case-classification-forbidden'
      changed: false
      trade: Trade
      reason: 'account-trade-forbidden'
      promoteLegacyFocusToStar: false
    }

function hasOwn<K extends PropertyKey>(value: object, key: K): value is Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function containsCaseClassificationMutation(patch: Record<string, unknown>): boolean {
  return hasOwn(patch, 'caseType') || hasOwn(patch, 'masteryState') || hasOwn(patch, 'nextReviewAt')
}

function resolveReviewMirror(
  masteryState: MasteryState | undefined,
  caseType: CaseType | undefined,
): Pick<Trade, 'reviewCategory' | 'reviewStatus'> {
  if (masteryState === 'mastered') {
    return { reviewCategory: 'mastered', reviewStatus: 'reviewed' }
  }
  if (masteryState === 'recheck') {
    return { reviewCategory: 'recheck', reviewStatus: 'unreviewed' }
  }
  if (caseType === 'mistake') {
    return { reviewCategory: 'mistake', reviewStatus: 'unreviewed' }
  }
  if (caseType === 'ambiguous') {
    return { reviewCategory: 'ambiguous', reviewStatus: 'unreviewed' }
  }
  return { reviewCategory: 'normal', reviewStatus: 'unreviewed' }
}

/**
 * 将旧版“案例星标 / focus 镜像”升级为独立学习优先级。
 * 返回的 starredIds 只保留实盘与模拟记录，避免两套语义继续串联。
 */
export function migrateLegacyCasePriority(
  trades: readonly Trade[],
  starredIds: readonly string[],
): { trades: Trade[]; starredIds: string[] } {
  const starred = new Set(starredIds)
  const caseIds = new Set<string>()
  const migrated = trades.map((trade) => {
    if (trade.tradeKind !== 'case') return trade
    caseIds.add(trade.id)
    const legacyFocus = trade.reviewCategory === 'focus' || trade.reviewStatus === 'focus'
    if (!starred.has(trade.id) && !legacyFocus) return trade
    const mirror = resolveReviewMirror(trade.masteryState, trade.caseType)
    return {
      ...trade,
      isFocusCase: true,
      ...(legacyFocus ? mirror : {}),
    }
  })
  return {
    trades: migrated,
    starredIds: starredIds.filter((id) => !caseIds.has(id)),
  }
}

function hasClassificationChanged(previous: Trade, next: Trade): boolean {
  return previous.caseType !== next.caseType ||
    previous.masteryState !== next.masteryState ||
    previous.nextReviewAt !== next.nextReviewAt ||
    previous.reviewCategory !== next.reviewCategory ||
    previous.reviewStatus !== next.reviewStatus
}

export function applyCaseClassificationMutation(
  trade: Trade,
  mutation: CaseClassificationMutation,
): CaseClassificationMutationResult {
  if (trade.tradeKind !== 'case') {
    return {
      ok: false,
      code: 'review-case-classification-forbidden',
      changed: false,
      trade,
      reason: 'account-trade-forbidden',
      promoteLegacyFocusToStar: false,
    }
  }

  if (!containsCaseClassificationMutation(mutation)) {
    return { ok: true, changed: false, trade, promoteLegacyFocusToStar: false }
  }

  const hasCaseType = hasOwn(mutation, 'caseType')
  const hasMasteryState = hasOwn(mutation, 'masteryState')
  const hasNextReviewAt = hasOwn(mutation, 'nextReviewAt')
  const caseType = hasCaseType ? mutation.caseType : trade.caseType
  const masteryState = hasMasteryState ? mutation.masteryState : trade.masteryState
  const mirror = resolveReviewMirror(masteryState, caseType)
  const next: Trade = {
    ...trade,
    ...(hasCaseType ? { caseType } : {}),
    ...(hasMasteryState ? { masteryState } : {}),
    ...(hasNextReviewAt ? { nextReviewAt: mutation.nextReviewAt } : {}),
    ...mirror,
  }

  return {
    ok: true,
    changed: hasClassificationChanged(trade, next),
    trade: next,
    promoteLegacyFocusToStar: false,
  }
}

import type { Trade } from '@/data/trades'
import { formatYmd } from '@/lib/periods'
import {
  matchesReviewCaseScope,
  type ReviewCaseScope,
} from '@/lib/reviewCaseScope'
import { isTypingTarget, normalizeKey } from '@/shortcuts/chords'

export type ReviewSessionFilters = {
  includeCases: boolean
  includeAccountTrades: boolean
  caseScope: ReviewCaseScope
  requireContent: boolean
}

export type ReviewSessionSnapshot = {
  ids: string[]
  cursor: number
  filters: ReviewSessionFilters
  assessments: Partial<Record<string, ReviewSessionAssessment>>
  /** 当前应用会话内精确定位评估动作；重启后历史栈清空，ID 只用于安全拒绝。 */
  /** string 表示可精确撤销的动作；null 表示本次评估成功但最终字段无变化。 */
  assessmentActionIds?: Partial<Record<string, string | null>>
  /** 评估前的交易快照，供会话内「上一条」还原 */
  /** @deprecated 旧会话兼容读取；不得再用于整条 Trade 覆盖。 */
  assessmentPrev?: Partial<Record<string, Trade>>
}

export type ReviewSessionAssessment = 'unfamiliar' | 'recheck' | 'mastered'

export function buildReviewAssessmentPatch(
  trade: Trade,
  assessment: ReviewSessionAssessment,
  now: Date = new Date(),
) {
  if (assessment === 'mastered') {
    return {
      masteryState: 'mastered' as const,
      nextReviewAt: null,
      reviewStatus: 'reviewed' as const,
      reviewCategory: 'mastered' as const,
    }
  }

  const nextReview = new Date(now)
  nextReview.setDate(nextReview.getDate() + (assessment === 'unfamiliar' ? 3 : 7))
  if (assessment === 'recheck') {
    return {
      masteryState: 'recheck' as const,
      nextReviewAt: formatYmd(nextReview),
      reviewStatus: 'unreviewed' as const,
      reviewCategory: 'recheck' as const,
    }
  }

  const reviewCategory = trade.reviewCategory !== 'mastered' && trade.reviewCategory !== 'recheck'
    ? trade.reviewCategory
    : trade.caseType === 'mistake'
      ? 'mistake' as const
      : trade.caseType === 'ambiguous'
        ? 'ambiguous' as const
        : 'normal' as const
  return {
    masteryState: 'new' as const,
    nextReviewAt: formatYmd(nextReview),
    reviewStatus: 'unreviewed' as const,
    reviewCategory,
  }
}

export type ReviewSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReviewSessionKeyAction = ReviewSessionAssessment | 'skip' | 'back'

const REVIEW_SESSION_SCOPES: ReviewCaseScope[] = [
  'all',
  'focus',
  'mistakes',
  'unreviewed',
  'reviewed',
]

export const DEFAULT_REVIEW_SESSION_FILTERS: ReviewSessionFilters = {
  includeCases: true,
  includeAccountTrades: true,
  caseScope: 'all',
  requireContent: false,
}

export function hasEffectiveReviewContent(note: string | null | undefined): boolean {
  if (!note) return false
  if (/<img\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>/i.test(note)) return true
  const text = note
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0
}

export function buildReviewSessionPool(
  trades: readonly Trade[],
  filters: ReviewSessionFilters,
  starredIds: ReadonlySet<string>,
): Trade[] {
  return trades.filter((trade) => {
    if (trade.deletedAt) return false
    if (filters.requireContent && !hasEffectiveReviewContent(trade.note)) return false
    if (trade.tradeKind === 'case') {
      return filters.includeCases && matchesReviewCaseScope(trade, filters.caseScope, starredIds)
    }
    return filters.includeAccountTrades && (trade.tradeKind === 'live' || trade.tradeKind === 'paper')
  })
}

/** Fisher–Yates；返回新数组并允许测试注入随机源。 */
export function shuffleReviewSessionIds<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!]
  }
  return shuffled
}

export function reconcileReviewSession(
  snapshot: ReviewSessionSnapshot,
  trades: readonly Trade[],
  starredIds: ReadonlySet<string>,
): ReviewSessionSnapshot | null {
  const eligibleIds = new Set(
    buildReviewSessionPool(trades, snapshot.filters, starredIds).map((trade) => trade.id),
  )
  const ids = snapshot.ids.filter((id) => eligibleIds.has(id))
  if (ids.length === 0) return null

  const cursor = snapshot.cursor >= snapshot.ids.length
    ? ids.length
    : snapshot.ids.slice(0, snapshot.cursor).filter((id) => eligibleIds.has(id)).length

  return {
    ids,
    cursor: Math.min(cursor, ids.length),
    filters: snapshot.filters,
    assessments: Object.fromEntries(
      Object.entries(snapshot.assessments).filter(([id]) => eligibleIds.has(id)),
    ),
  }
}

export function reviewSessionKeyAction(event: KeyboardEvent): ReviewSessionKeyAction | null {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  ) {
    return null
  }
  const target = event.target as HTMLElement | null
  if (
    isTypingTarget(target) ||
    target?.closest?.(
      'button, a[href], select, summary, [role="button"], [role="link"], [role="combobox"]',
    )
  ) return null

  const key = normalizeKey(event.key)
  if (key === '1') return 'unfamiliar'
  if (key === '2') return 'recheck'
  if (key === '3') return 'mastered'
  if (key === 'n' || key === 'arrowright') return 'skip'
  if (key === 'p' || key === 'arrowleft') return 'back'
  return null
}

export function reviewSessionStorageKey(libraryId: string): string {
  return `yunkoo-atlas:review-session:v2:${encodeURIComponent(libraryId)}`
}

function browserSessionStorage(): ReviewSessionStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function saveReviewSession(
  libraryId: string,
  snapshot: ReviewSessionSnapshot,
  storage: ReviewSessionStorage | null = browserSessionStorage(),
): boolean {
  if (!storage || !libraryId) return false
  try {
    storage.setItem(reviewSessionStorageKey(libraryId), JSON.stringify({
      ids: snapshot.ids,
      cursor: snapshot.cursor,
      filters: {
        includeCases: snapshot.filters.includeCases,
        includeAccountTrades: snapshot.filters.includeAccountTrades,
        caseScope: snapshot.filters.caseScope,
        requireContent: snapshot.filters.requireContent,
      },
      assessments: snapshot.assessments,
    }))
    return true
  } catch {
    return false
  }
}

export function loadReviewSession(
  libraryId: string,
  storage: ReviewSessionStorage | null = browserSessionStorage(),
): ReviewSessionSnapshot | null {
  if (!storage || !libraryId) return null
  const key = reviewSessionStorageKey(libraryId)
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    if (!isReviewSessionSnapshot(value)) {
      try { storage.removeItem(key) } catch { /* storage may be read-only */ }
      return null
    }
    return value
  } catch {
    try { storage.removeItem(key) } catch { /* storage may be unavailable */ }
    return null
  }
}

export function clearReviewSessionStorage(
  libraryId: string,
  storage: ReviewSessionStorage | null = browserSessionStorage(),
): boolean {
  if (!storage || !libraryId) return false
  try {
    storage.removeItem(reviewSessionStorageKey(libraryId))
    return true
  } catch {
    return false
  }
}

export function clearReviewSession(
  libraryId: string,
  storage: ReviewSessionStorage | null = browserSessionStorage(),
): boolean {
  return clearReviewSessionStorage(libraryId, storage)
}

function isReviewSessionSnapshot(value: unknown): value is ReviewSessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<ReviewSessionSnapshot>
  if (!Array.isArray(snapshot.ids) || !snapshot.ids.every((id) => typeof id === 'string' && id.length > 0)) {
    return false
  }
  if (!Number.isInteger(snapshot.cursor) || snapshot.cursor! < 0 || snapshot.cursor! > snapshot.ids.length) {
    return false
  }
  if (!isReviewSessionFilters(snapshot.filters) || !isReviewSessionAssessments(snapshot.assessments)) return false
  return new Set(snapshot.ids).size === snapshot.ids.length
}

function isReviewSessionAssessments(
  value: unknown,
): value is Partial<Record<string, ReviewSessionAssessment>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const valid = new Set<ReviewSessionAssessment>(['unfamiliar', 'recheck', 'mastered'])
  return Object.entries(value).every(([id, assessment]) => id.length > 0 && valid.has(assessment as ReviewSessionAssessment))
}

function isReviewSessionFilters(value: unknown): value is ReviewSessionFilters {
  if (!value || typeof value !== 'object') return false
  const filters = value as Partial<ReviewSessionFilters>
  return (
    typeof filters.includeCases === 'boolean' &&
    typeof filters.includeAccountTrades === 'boolean' &&
    typeof filters.requireContent === 'boolean' &&
    REVIEW_SESSION_SCOPES.includes(filters.caseScope as ReviewCaseScope)
  )
}

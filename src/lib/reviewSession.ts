import { type Trade } from '@/data/trades'
import {
  addDaysToCurrentTradingDay,
  DEFAULT_TRADING_DAY_START_HOUR,
  getTradingDayKey,
} from '@/lib/periods'
import {
  matchesReviewCaseScope,
  REVIEW_CASE_SCOPE_LABELS,
  REVIEW_CASE_SCOPES,
  type ReviewCaseScope,
} from '@/lib/reviewCaseScope'
import { resolveTradeTruth } from '@/lib/tradeTruth'
import type { LiveStage } from '@/lib/liveStages'
import type { SystemReviewPoolId } from '@/lib/reviewPools'

export type ReviewStageSource =
  | 'current-and-history'
  | 'current'
  | 'all-history'
  | { stageIds: string[] }

export const REVIEW_STAGE_SOURCE_LABELS = {
  'current-and-history': '全部阶段',
  current: '仅当前阶段',
  'all-history': '仅历史阶段',
} as const satisfies Record<Exclude<ReviewStageSource, { stageIds: string[] }>, string>

export function reviewStageSourceLabel(stageSource: ReviewStageSource): string {
  if (typeof stageSource === 'string') return REVIEW_STAGE_SOURCE_LABELS[stageSource]
  return stageSource.stageIds.length === 0
    ? '尚未选择实盘阶段'
    : `自选 ${stageSource.stageIds.length} 个阶段`
}

export type ReviewStageContext = {
  liveStages: readonly LiveStage[]
  currentLiveStageId: string
}

export type ReviewSessionFilters = {
  includeCases: boolean
  includeLiveTrades: boolean
  includePaperTrades: boolean
  /** @deprecated 仅供旧调用方编译兼容；v3 不再持久化。 */
  includeAccountTrades?: boolean
  caseScope: ReviewCaseScope
  requireContent: boolean
  reviewTiming: ReviewTiming
  stageSource: ReviewStageSource
}

export type ReviewTiming = 'due' | 'all'

type StoredReviewSessionFilters = Omit<ReviewSessionFilters, 'reviewTiming' | 'stageSource'> & {
  reviewTiming?: ReviewTiming
  stageSource?: ReviewStageSource
}

type StoredReviewSessionSnapshot = Omit<ReviewSessionSnapshot, 'filters'> & {
  filters: StoredReviewSessionFilters
}

export type ReviewSessionSnapshot = {
  ids: string[]
  cursor: number
  filters: ReviewSessionFilters
  /** 新首页系统池来源；仅保存在按 libraryId 隔离的临时会话中。 */
  systemPoolId?: SystemReviewPoolId
  /** 自定义复盘池来源；轮次仍冻结 ID，此字段只用于重新洗牌。 */
  customPoolId?: string
  assessments: Partial<Record<string, ReviewSessionAssessment>>
  /** 当前应用会话内精确定位评估动作；重启后历史栈清空，ID 只用于安全拒绝。 */
  /** string 表示可精确撤销的动作；null 表示本次评估成功但最终字段无变化。 */
  assessmentActionIds?: Partial<Record<string, string | null>>
  /** 评估前的交易快照，供会话内「上一条」还原 */
  /** @deprecated 旧会话兼容读取；不得再用于整条 Trade 覆盖。 */
  assessmentPrev?: Partial<Record<string, Trade>>
  /** 仅用于正在恢复的升级前轮次；保存时继续省略 timing，直到该轮结束。 */
  restoredLegacyReviewTiming?: true
}

export type ReviewSessionAssessment = 'unfamiliar' | 'recheck' | 'mastered'

export function buildReviewAssessmentPatch(
  trade: Trade,
  assessment: ReviewSessionAssessment,
  now: Date = new Date(),
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
) {
  if (trade.tradeKind !== 'case') {
    return {}
  }

  if (assessment === 'mastered') {
    return {
      masteryState: 'mastered' as const,
      nextReviewAt: null,
      reviewStatus: 'reviewed' as const,
      reviewCategory: 'mastered' as const,
    }
  }

  const nextReviewAt = addDaysToCurrentTradingDay(
    now,
    tradingDayStartHour,
    assessment === 'unfamiliar' ? 3 : 7,
  )
  if (assessment === 'recheck') {
    return {
      masteryState: 'recheck' as const,
      nextReviewAt,
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
    nextReviewAt,
    reviewStatus: 'unreviewed' as const,
    reviewCategory,
  }
}

export type ReviewSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const REVIEW_SESSION_SCOPES: readonly ReviewCaseScope[] = REVIEW_CASE_SCOPES

export type ReviewSessionPresetId = 'due' | 'exemplar' | 'mistakes' | 'missed'

export type ReviewSessionPreset = {
  id: ReviewSessionPresetId
  label: string
  hint: string
  filters: Pick<
    ReviewSessionFilters,
    'includeCases' | 'includeLiveTrades' | 'includePaperTrades' | 'caseScope' | 'reviewTiming'
  >
}

export const REVIEW_SESSION_PRESETS: readonly ReviewSessionPreset[] = [
  {
    id: 'due',
    label: '到期复盘',
    hint: '到期案例，以及所选阶段内的实盘',
    filters: {
      includeCases: true,
      includeLiveTrades: true,
      includePaperTrades: false,
      caseScope: 'all',
      reviewTiming: 'due',
    },
  },
  {
    id: 'exemplar',
    label: '交易案例',
    hint: '全部案例知识库，含未到期与已掌握',
    filters: {
      includeCases: true,
      includeLiveTrades: false,
      includePaperTrades: false,
      caseScope: 'all',
      reviewTiming: 'all',
    },
  },
  {
    id: 'mistakes',
    label: REVIEW_CASE_SCOPE_LABELS.mistakes,
    hint: '错题案例，含未到期与已掌握',
    filters: {
      includeCases: true,
      includeLiveTrades: false,
      includePaperTrades: false,
      caseScope: 'mistakes',
      reviewTiming: 'all',
    },
  },
  {
    id: 'missed',
    label: REVIEW_CASE_SCOPE_LABELS.missed,
    hint: '错过机会案例，含未到期与已掌握',
    filters: {
      includeCases: true,
      includeLiveTrades: false,
      includePaperTrades: false,
      caseScope: 'missed',
      reviewTiming: 'all',
    },
  },
]

export function applyReviewSessionPreset(
  current: ReviewSessionFilters,
  preset: ReviewSessionPreset,
): ReviewSessionFilters {
  return {
    ...current,
    ...preset.filters,
    includeAccountTrades: false,
  }
}

export function matchReviewSessionPreset(
  filters: ReviewSessionFilters,
): ReviewSessionPresetId | null {
  const matched = REVIEW_SESSION_PRESETS.find((preset) => (
    filters.includeCases === preset.filters.includeCases &&
    filters.includeLiveTrades === preset.filters.includeLiveTrades &&
    filters.includePaperTrades === preset.filters.includePaperTrades &&
    filters.caseScope === preset.filters.caseScope &&
    filters.reviewTiming === preset.filters.reviewTiming
  ))
  return matched?.id ?? null
}

export const DEFAULT_REVIEW_SESSION_FILTERS: ReviewSessionFilters = {
  includeCases: true,
  includeLiveTrades: true,
  includePaperTrades: false,
  includeAccountTrades: false,
  caseScope: 'all',
  requireContent: false,
  reviewTiming: 'due',
  stageSource: 'current-and-history',
}

export function normalizeReviewStageSource(
  stageSource: ReviewStageSource,
  liveStages: readonly LiveStage[],
): ReviewStageSource {
  if (typeof stageSource === 'string') return stageSource
  const selected = new Set(stageSource.stageIds)
  return {
    stageIds: [...liveStages]
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
      .filter((stage) => selected.has(stage.id))
      .map((stage) => stage.id),
  }
}

export function reviewFiltersForNextRound(
  snapshot: ReviewSessionSnapshot,
): ReviewSessionFilters {
  if (!snapshot.restoredLegacyReviewTiming) return snapshot.filters
  return {
    ...snapshot.filters,
    reviewTiming: DEFAULT_REVIEW_SESSION_FILTERS.reviewTiming,
  }
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

/** 随机复盘展示案例自身洞见及其来源交易快照，账户交易仍只读取自身正文。 */
export function getReviewSessionContent(trade: Trade): string {
  if (trade.tradeKind !== 'case') return trade.note
  const ownNote = hasEffectiveReviewContent(trade.note) ? trade.note : ''
  const sourceNote = hasEffectiveReviewContent(trade.sourceNoteHtml) ? trade.sourceNoteHtml! : ''
  if (!ownNote) return sourceNote
  if (!sourceNote) return ownNote
  return [
    '<section data-review-session-section="case"><h2>案例洞见</h2>',
    ownNote,
    '</section><section data-review-session-section="source"><h2>来源交易复盘</h2>',
    sourceNote,
    '</section>',
  ].join('')
}

export function buildReviewSessionPool(
  trades: readonly Trade[],
  filters: ReviewSessionFilters,
  starredIds: ReadonlySet<string>,
  currentTradingDayKey: string,
  tradingDayStartHour: number,
  stageContext: ReviewStageContext,
): Trade[] {
  const stageSource = normalizeReviewStageSource(
    filters.stageSource ?? DEFAULT_REVIEW_SESSION_FILTERS.stageSource,
    stageContext.liveStages,
  )
  const stageById = new Map(stageContext.liveStages.map((stage) => [stage.id, stage]))
  return trades.filter((trade) => {
    if (trade.deletedAt) return false
    if (trade.tradeKind === 'live') {
      const stage = typeof trade.liveStageId === 'string'
        ? stageById.get(trade.liveStageId)
        : undefined
      if (!stage) return false
      if (stageSource === 'current' && stage.id !== stageContext.currentLiveStageId) return false
      if (stageSource === 'all-history' && (
        stage.status !== 'archived' || stage.id === stageContext.currentLiveStageId
      )) return false
      if (typeof stageSource === 'object' && !stageSource.stageIds.includes(stage.id)) return false
    }
    const content = getReviewSessionContent(trade)
    if (filters.requireContent && !hasEffectiveReviewContent(content)) return false
    if (trade.tradeKind === 'case') {
      if (!filters.includeCases || !matchesReviewCaseScope(trade, filters.caseScope, starredIds)) return false
      if (filters.reviewTiming === 'all') return true
      if (trade.masteryState === 'mastered') return false
      return isReviewCaseDue(trade.nextReviewAt, currentTradingDayKey, tradingDayStartHour)
    }
    const includeLegacyAccounts = filters.includeAccountTrades === true
    if (trade.tradeKind === 'live' && !filters.includeLiveTrades && !includeLegacyAccounts) return false
    if (trade.tradeKind === 'paper' && !filters.includePaperTrades && !includeLegacyAccounts) return false
    if (trade.tradeKind !== 'live' && trade.tradeKind !== 'paper') return false
    const executionState = resolveTradeTruth(trade).executionState
    return executionState === 'closed' || executionState === 'missed'
  })
}

function isReviewCaseDue(
  nextReviewAt: string | null | undefined,
  currentTradingDayKey: string,
  tradingDayStartHour: number,
): boolean {
  if (!nextReviewAt) return true
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nextReviewAt)
  if (ymd) {
    const year = Number(ymd[1])
    const month = Number(ymd[2])
    const day = Number(ymd[3])
    if (!isValidCalendarDate(year, month, day)) return true
    return nextReviewAt <= currentTradingDayKey
  }
  const legacyDate = parseStrictLegacyIsoDate(nextReviewAt)
  if (!legacyDate) return true
  return getTradingDayKey(legacyDate, tradingDayStartHour) <= currentTradingDayKey
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]!
}

function parseStrictLegacyIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))?$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[7] === undefined ? 0 : Number(match[7])
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8])
  if (
    !isValidCalendarDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) return null

  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
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
  currentTradingDayKey: string,
  tradingDayStartHour: number,
  stageContext: ReviewStageContext,
): ReviewSessionSnapshot | null {
  const stageSource = normalizeReviewStageSource(
    snapshot.filters.stageSource ?? DEFAULT_REVIEW_SESSION_FILTERS.stageSource,
    stageContext.liveStages,
  )
  const eligibleIds = new Set(
    buildReviewSessionPool(
      trades,
      { ...snapshot.filters, stageSource: 'current-and-history' },
      starredIds,
      currentTradingDayKey,
      tradingDayStartHour,
      stageContext,
    ).map((trade) => trade.id),
  )
  const ids = snapshot.ids.filter((id) => eligibleIds.has(id))
  if (ids.length === 0 && !(typeof stageSource === 'object' && stageSource.stageIds.length === 0)) {
    return null
  }

  const cursor = snapshot.cursor >= snapshot.ids.length
    ? ids.length
    : snapshot.ids.slice(0, snapshot.cursor).filter((id) => eligibleIds.has(id)).length

  return {
    ids,
    cursor: Math.min(cursor, ids.length),
    filters: { ...snapshot.filters, stageSource },
    assessments: Object.fromEntries(
      Object.entries(snapshot.assessments).filter(([id]) => eligibleIds.has(id)),
    ),
    ...(snapshot.restoredLegacyReviewTiming ? { restoredLegacyReviewTiming: true as const } : {}),
  }
}

export function reviewSessionStorageKey(libraryId: string): string {
  return `yunkoo-atlas:review-session:v3:${encodeURIComponent(libraryId)}`
}

export function reviewSessionFiltersStorageKey(libraryId: string): string {
  return `yunkoo-atlas:review-session-filters:v1:${encodeURIComponent(libraryId)}`
}

function legacyReviewSessionStorageKeys(libraryId: string): string[] {
  const encoded = encodeURIComponent(libraryId)
  return [
    `yunkoo-atlas:review-session:v2:${encoded}`,
    `yunkoo-atlas:review-session:v1:${encoded}`,
  ]
}

function browserSessionStorage(): ReviewSessionStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function browserLocalStorage(): ReviewSessionStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function serializeReviewFilters(
  filters: ReviewSessionFilters,
  options: { omitLegacyTiming?: boolean } = {},
): StoredReviewSessionFilters {
  return {
    includeCases: filters.includeCases,
    includeLiveTrades: filters.includeLiveTrades,
    includePaperTrades: filters.includePaperTrades,
    caseScope: filters.caseScope,
    requireContent: filters.requireContent,
    ...(options.omitLegacyTiming ? {} : { reviewTiming: filters.reviewTiming }),
    stageSource: filters.stageSource,
  }
}

function restoreReviewFilters(filters: StoredReviewSessionFilters): ReviewSessionFilters {
  return {
    includeCases: filters.includeCases,
    includeLiveTrades: filters.includeLiveTrades,
    includePaperTrades: filters.includePaperTrades,
    includeAccountTrades: false,
    caseScope: filters.caseScope,
    requireContent: filters.requireContent,
    reviewTiming: filters.reviewTiming ?? DEFAULT_REVIEW_SESSION_FILTERS.reviewTiming,
    stageSource: filters.stageSource ?? DEFAULT_REVIEW_SESSION_FILTERS.stageSource,
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
      filters: serializeReviewFilters(snapshot.filters, {
        omitLegacyTiming: Boolean(snapshot.restoredLegacyReviewTiming),
      }),
      ...(snapshot.systemPoolId ? { systemPoolId: snapshot.systemPoolId } : {}),
      ...(snapshot.customPoolId ? { customPoolId: snapshot.customPoolId } : {}),
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
    const sourceKey = [key, ...legacyReviewSessionStorageKeys(libraryId)]
      .find((candidate) => storage.getItem(candidate) !== null)
    if (!sourceKey) return null
    const raw = storage.getItem(sourceKey)
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    const normalized = normalizeStoredReviewSession(value)
    if (!normalized) {
      try { storage.removeItem(sourceKey) } catch { /* storage may be read-only */ }
      return null
    }
    const restoredLegacyReviewTiming = normalized.filters.reviewTiming === undefined
    const restored: ReviewSessionSnapshot = {
      ...normalized,
      filters: restoreReviewFilters({
        ...normalized.filters,
        reviewTiming: normalized.filters.reviewTiming ?? 'all',
        stageSource: normalized.filters.stageSource ?? 'current-and-history',
      }),
      ...(restoredLegacyReviewTiming ? { restoredLegacyReviewTiming: true } : {}),
    }
    if (sourceKey !== key && saveReviewSession(libraryId, restored, storage)) {
      for (const legacyKey of legacyReviewSessionStorageKeys(libraryId)) {
        try { storage.removeItem(legacyKey) } catch { /* v3 已先写入，旧键清理可重试 */ }
      }
    }
    return restored
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
    for (const key of legacyReviewSessionStorageKeys(libraryId)) storage.removeItem(key)
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

export function saveReviewSessionFilters(
  libraryId: string,
  filters: ReviewSessionFilters,
  storage: ReviewSessionStorage | null = browserLocalStorage(),
): boolean {
  if (!storage || !libraryId) return false
  try {
    storage.setItem(
      reviewSessionFiltersStorageKey(libraryId),
      JSON.stringify(serializeReviewFilters(filters)),
    )
    return true
  } catch {
    return false
  }
}

export function loadReviewSessionFilters(
  libraryId: string,
  storage: ReviewSessionStorage | null = browserLocalStorage(),
): ReviewSessionFilters | null {
  if (!storage || !libraryId) return null
  const key = reviewSessionFiltersStorageKey(libraryId)
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    const normalized = normalizeStoredFilters(value)
    if (!normalized) {
      try { storage.removeItem(key) } catch { /* storage may be read-only */ }
      return null
    }
    return restoreReviewFilters(normalized)
  } catch {
    try { storage.removeItem(key) } catch { /* storage may be unavailable */ }
    return null
  }
}

export function clearReviewSessionFilters(
  libraryId: string,
  storage: ReviewSessionStorage | null = browserLocalStorage(),
): boolean {
  if (!storage || !libraryId) return false
  try {
    storage.removeItem(reviewSessionFiltersStorageKey(libraryId))
    return true
  } catch {
    return false
  }
}

function isReviewSessionSnapshot(value: unknown): value is StoredReviewSessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<ReviewSessionSnapshot>
  if (!Array.isArray(snapshot.ids) || !snapshot.ids.every((id) => typeof id === 'string' && id.length > 0)) {
    return false
  }
  if (!Number.isInteger(snapshot.cursor) || snapshot.cursor! < 0 || snapshot.cursor! > snapshot.ids.length) {
    return false
  }
  if (!isReviewSessionFilters(snapshot.filters) || !isReviewSessionAssessments(snapshot.assessments)) return false
  if (
    snapshot.systemPoolId !== undefined &&
    !['all', 'cases', 'losses', 'wins', 'missed', 'boosted'].includes(snapshot.systemPoolId)
  ) return false
  if (snapshot.customPoolId !== undefined && (
    typeof snapshot.customPoolId !== 'string' || !snapshot.customPoolId.trim()
  )) return false
  if (snapshot.systemPoolId !== undefined && snapshot.customPoolId !== undefined) return false
  return new Set(snapshot.ids).size === snapshot.ids.length
}

function normalizeStoredFilters(value: unknown): StoredReviewSessionFilters | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const filters = { ...(value as Record<string, unknown>) }
  if (
    typeof filters.includeLiveTrades !== 'boolean' ||
    typeof filters.includePaperTrades !== 'boolean'
  ) {
    if (typeof filters.includeAccountTrades !== 'boolean') return null
    filters.includeLiveTrades = filters.includeAccountTrades
    filters.includePaperTrades = filters.includeAccountTrades
  }
  return isReviewSessionFilters(filters) ? filters : null
}

function normalizeStoredReviewSession(value: unknown): StoredReviewSessionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as { filters?: unknown }
  const filters = normalizeStoredFilters(snapshot.filters)
  if (!filters) return null
  snapshot.filters = filters
  return isReviewSessionSnapshot(value) ? value : null
}

function isReviewSessionAssessments(
  value: unknown,
): value is Partial<Record<string, ReviewSessionAssessment>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const valid = new Set<ReviewSessionAssessment>(['unfamiliar', 'recheck', 'mastered'])
  return Object.entries(value).every(([id, assessment]) => id.length > 0 && valid.has(assessment as ReviewSessionAssessment))
}

function isReviewSessionFilters(value: unknown): value is StoredReviewSessionFilters {
  if (!value || typeof value !== 'object') return false
  const filters = value as Partial<ReviewSessionFilters>
  return (
    typeof filters.includeCases === 'boolean' &&
    typeof filters.includeLiveTrades === 'boolean' &&
    typeof filters.includePaperTrades === 'boolean' &&
    typeof filters.requireContent === 'boolean' &&
    (filters.reviewTiming === undefined || filters.reviewTiming === 'due' || filters.reviewTiming === 'all') &&
    (filters.stageSource === undefined || isReviewStageSource(filters.stageSource)) &&
    REVIEW_SESSION_SCOPES.includes(filters.caseScope as ReviewCaseScope)
  )
}

function isReviewStageSource(value: unknown): value is ReviewStageSource {
  if (
    value === 'current-and-history' ||
    value === 'current' ||
    value === 'all-history'
  ) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const stageIds = (value as { stageIds?: unknown }).stageIds
  return Array.isArray(stageIds) && stageIds.every((id) => typeof id === 'string' && id.length > 0)
}

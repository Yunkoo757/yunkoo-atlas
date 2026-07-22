import type { PersistedSnapshot } from '@/storage/types'
import { isTradeResultAuthorityConsistent } from '@/lib/tradeTruth'

const TRADE_SIDES = new Set(['long', 'short'])
const TRADE_STATUSES = new Set(['planned', 'open', 'missed', 'win', 'loss', 'breakeven'])
const TRADE_KINDS = new Set(['live', 'paper', 'case'])
const CONVICTIONS = new Set(['low', 'medium', 'high', 'urgent'])
const RESULT_SOURCES = new Set(['pnl', 'r', 'price', 'imported'])
const REVIEW_STATUSES = new Set(['unreviewed', 'reviewed', 'focus'])
const REVIEW_CATEGORIES = new Set(['normal', 'mistake', 'focus', 'ambiguous', 'recheck', 'mastered'])
const ACTIVITY_KINDS = new Set(['create', 'status', 'strategy', 'tag', 'comment', 'note', 'tradeKind'])
const CASE_TYPES = new Set(['exemplar', 'mistake', 'ambiguous', 'missed'])
const MASTERY_STATES = new Set(['new', 'recheck', 'mastered'])
const MISS_REASONS = new Set(['hesitation', 'missed_setup', 'no_alert', 'rule_break', 'other'])
const DISPLAY_SORTS = new Set(['date', 'pnl', 'conviction'])
const SIDEBAR_SYSTEM_IDS = new Set(['active', 'favorites', 'missed', 'paper'])
const CASE_VIEW_SCOPES = new Set(['focus', 'mistakes', 'unreviewed', 'reviewed'])
const WEEKLY_REVIEW_STATUSES = new Set(['draft', 'completed'])
const WEEKLY_COMMITMENT_RESULTS = new Set(['done', 'partial', 'missed', 'not-applicable'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isTradeComment(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string'
}

function isActivityEvent(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' || !value.id.trim() ||
    typeof value.timestamp !== 'string' ||
    !ACTIVITY_KINDS.has(String(value.kind))
  ) return false
  if (value.status !== undefined && !TRADE_STATUSES.has(String(value.status))) return false
  if (value.tagAction !== undefined && value.tagAction !== 'add' && value.tagAction !== 'remove') return false
  if (value.fromTradeKind !== undefined && !TRADE_KINDS.has(String(value.fromTradeKind))) return false
  if (value.toTradeKind !== undefined && !TRADE_KINDS.has(String(value.toTradeKind))) return false
  for (const field of ['strategyId', 'fromStrategyId', 'tag', 'commentId', 'text']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false
  }
  return true
}

function isSidebarTarget(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.kind === 'system') {
    if (!SIDEBAR_SYSTEM_IDS.has(String(value.id))) return false
    if (value.workspaces === undefined) return true
    if (!Array.isArray(value.workspaces)) return false
    const id = String(value.id)
    const allowed =
      id === 'missed' ? new Set(['trade', 'paper', 'case'])
        : id === 'active' ? new Set(['trade', 'paper'])
          : null
    if (!allowed) return value.workspaces.length === 0
    return value.workspaces.every(
      (workspace) => typeof workspace === 'string' && allowed.has(workspace),
    )
  }
  if (value.kind === 'saved-view') return typeof value.viewId === 'string' && Boolean(value.viewId.trim())
  if (value.kind === 'strategy') return typeof value.strategyId === 'string' && Boolean(value.strategyId.trim())
  if (value.kind === 'case-view') return CASE_VIEW_SCOPES.has(String(value.scope))
  // 兼容短暂写入过的 quick-view 钉选：允许读入，随后由 normalizeSidebarWorkspaceItems 合并
  if (value.kind === 'quick-view') {
    const workspace = String(value.workspace)
    const view = String(value.view)
    if (!(workspace === 'trade' || workspace === 'paper' || workspace === 'case')) return false
    if (!(view === 'missed' || view === 'active')) return false
    if (workspace === 'case' && view === 'active') return false
    return true
  }
  return false
}

function isSidebarWorkspaceItem(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id.trim()) &&
    isSidebarTarget(value.target) &&
    (value.placement === 'pinned' || value.placement === 'overflow') &&
    typeof value.order === 'number' &&
    Number.isFinite(value.order)
}

function isWorkspaceMemoryEntry(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.pathname === 'string' &&
    (value.search === undefined || typeof value.search === 'string')
}

function isDisplayPrefs(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  for (const field of ['hideClosed', 'showEmptyGroups', 'groupByStrategy', 'groupByDate', 'reviewContextPinned']) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') return false
  }
  if (value.sortBy !== undefined && !DISPLAY_SORTS.has(String(value.sortBy))) return false
  if (
    value.tradingDayStartHour !== undefined &&
    !(
      typeof value.tradingDayStartHour === 'number' &&
      Number.isInteger(value.tradingDayStartHour) &&
      value.tradingDayStartHour >= 0 &&
      value.tradingDayStartHour <= 23
    )
  ) {
    return false
  }
  if (value.sidebarPins !== undefined && !isStringArray(value.sidebarPins)) return false
  if (value.sidebarWorkspaceItems !== undefined && (
    !Array.isArray(value.sidebarWorkspaceItems) ||
    !value.sidebarWorkspaceItems.every(isSidebarWorkspaceItem)
  )) return false
  if (value.workspaceMemory !== undefined) {
    if (!isRecord(value.workspaceMemory)) return false
    for (const field of ['today', 'trade', 'case']) {
      const entry = value.workspaceMemory[field]
      if (entry !== undefined && !isWorkspaceMemoryEntry(entry)) return false
    }
  }
  return true
}

function isReviewTemplates(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value) &&
    value.length <= 30 &&
    value.every((template) =>
      isRecord(template) &&
      typeof template.id === 'string' && Boolean(template.id.trim()) &&
      typeof template.name === 'string' && Boolean(template.name.trim()) && template.name.length <= 40 &&
      typeof template.content === 'string' && template.content.length <= 4000
    ) &&
    !hasDuplicateStringId(value)
  )
}

export function isValidPersistedTrade(
  value: unknown,
): value is PersistedSnapshot['trades'][number] {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' || !value.id.trim() ||
    typeof value.ref !== 'string' ||
    typeof value.symbol !== 'string' ||
    typeof value.strategyId !== 'string' || !value.strategyId.trim() ||
    typeof value.openedAt !== 'string' ||
    !isStringArray(value.tags) ||
    typeof value.note !== 'string' ||
    !TRADE_SIDES.has(String(value.side)) ||
    !TRADE_STATUSES.has(String(value.status)) ||
    !CONVICTIONS.has(String(value.conviction)) ||
    typeof value.entry !== 'number' ||
    !Number.isFinite(value.entry) ||
    typeof value.size !== 'number' ||
    !Number.isFinite(value.size)
  ) return false
  if (value.tradeKind !== undefined && !TRADE_KINDS.has(String(value.tradeKind))) return false
  if (value.mistakeTags !== undefined && !isStringArray(value.mistakeTags)) return false
  if (value.reviewStatus !== undefined && !REVIEW_STATUSES.has(String(value.reviewStatus))) return false
  if (value.reviewCategory !== undefined && !REVIEW_CATEGORIES.has(String(value.reviewCategory))) return false
  if (value.caseType !== undefined && !CASE_TYPES.has(String(value.caseType))) return false
  if (value.masteryState !== undefined && !MASTERY_STATES.has(String(value.masteryState))) return false
  if (value.missReason !== undefined && !MISS_REASONS.has(String(value.missReason))) return false
  for (const field of [
    'session',
    'timeframe',
    'narrative',
    'psychology',
    'recordedAt',
    'sourceTradeId',
    'deletedAt',
    'deletedBy',
  ]) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false
  }
  if (
    value.nextReviewAt !== undefined &&
    value.nextReviewAt !== null &&
    typeof value.nextReviewAt !== 'string'
  ) return false
  if (!isNullableFiniteNumber(value.exit)) return false
  if (!isNullableFiniteNumber(value.pnl)) return false
  if (!isNullableFiniteNumber(value.rMultiple)) return false
  if (value.stopLoss !== undefined && !isNullableFiniteNumber(value.stopLoss)) return false
  if (value.initialStopLoss !== undefined && !isNullableFiniteNumber(value.initialStopLoss)) return false
  if (value.resultSource !== undefined && !RESULT_SOURCES.has(String(value.resultSource))) return false
  if (!isTradeResultAuthorityConsistent(value)) return false
  if (value.closedAt !== null && typeof value.closedAt !== 'string') return false
  if (value.reviewedAt !== undefined && value.reviewedAt !== null && typeof value.reviewedAt !== 'string') return false
  if (value.comments !== undefined && (
    !Array.isArray(value.comments) || !value.comments.every(isTradeComment)
  )) return false
  if (value.activities !== undefined && (
    !Array.isArray(value.activities) || !value.activities.every(isActivityEvent)
  )) return false
  return true
}

function isKeyChord(value: unknown): boolean {
  if (!isRecord(value) || typeof value.key !== 'string' || !value.key.trim()) return false
  for (const field of ['mod', 'shift', 'alt']) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') return false
  }
  return true
}

function isShortcutBinding(value: unknown): boolean {
  return isKeyChord(value) || (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isKeyChord)
  )
}

function isShortcutOverrides(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return Object.entries(value).every(([id, binding]) => (
    Boolean(id.trim()) && (binding === null || isShortcutBinding(binding))
  ))
}

function isUserProfile(value: unknown): boolean {
  return value === undefined || (
    isRecord(value) &&
    (value.avatarId === null || typeof value.avatarId === 'string') &&
    typeof value.displayName === 'string' &&
    (
      value.customAvatarDataUrl === undefined ||
      value.customAvatarDataUrl === null ||
      typeof value.customAvatarDataUrl === 'string'
    )
  )
}

function isSavedTradeView(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' || !value.id.trim() ||
    typeof value.name !== 'string' || !value.name.trim() ||
    typeof value.pathname !== 'string' ||
    typeof value.pinned !== 'boolean' ||
    typeof value.order !== 'number' || !Number.isFinite(value.order) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isRecord(value.search)
  ) return false
  return Object.entries(value.search).every(([key, item]) => (
    Boolean(key.trim()) && typeof item === 'string'
  ))
}

function isSavedTradeViews(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value) && value.every(isSavedTradeView)
  )
}

function isSymbolIconOverride(value: unknown): boolean {
  if (!isRecord(value) || typeof value.updatedAt !== 'string') return false
  for (const field of ['presetId', 'customDataUrl']) {
    if (
      value[field] !== undefined &&
      value[field] !== null &&
      typeof value[field] !== 'string'
    ) return false
  }
  return true
}

function isSymbolIcons(value: unknown): boolean {
  return value === undefined || (
    isRecord(value) && Object.entries(value).every(([symbol, override]) => (
      Boolean(symbol.trim()) && isSymbolIconOverride(override)
    ))
  )
}

function hasDuplicateStringId(values: unknown[]): boolean {
  const ids = new Set<string>()
  for (const value of values) {
    if (!isRecord(value) || typeof value.id !== 'string') continue
    if (ids.has(value.id)) return true
    ids.add(value.id)
  }
  return false
}

function isWeeklyReviewMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false
  for (const field of [
    'tradeCount', 'reviewedCount', 'evaluatedCount', 'winCount', 'lossCount',
    'breakevenCount', 'conflictCount', 'pnlCount', 'totalPnl', 'rCount',
  ]) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) return false
  }
  if (!isNullableFiniteNumber(value.winRate) || !isNullableFiniteNumber(value.averageR)) return false
  if (!isRecord(value.mistakeTagCounts) || !Object.values(value.mistakeTagCounts).every(
    (count) => typeof count === 'number' && Number.isFinite(count),
  )) return false
  if (value.missedCount !== undefined && (
    typeof value.missedCount !== 'number' || !Number.isFinite(value.missedCount)
  )) return false
  return value.missedReasonCounts === undefined || (
    isRecord(value.missedReasonCounts) && Object.values(value.missedReasonCounts).every(
      (count) => typeof count === 'number' && Number.isFinite(count),
    )
  )
}

function isWeeklyReview(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' || !value.id.trim() ||
    typeof value.weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.weekStart) ||
    typeof value.weekEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.weekEnd) ||
    !WEEKLY_REVIEW_STATUSES.has(String(value.status)) ||
    typeof value.contentHtml !== 'string' ||
    typeof value.commitmentText !== 'string' ||
    typeof value.commitmentCriteria !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) return false
  for (const field of ['executionScore', 'riskScore', 'emotionScore']) {
    const score = value[field]
    if (score !== null && (
      typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5
    )) return false
  }
  for (const field of [
    'strengthTags', 'mistakeTags', 'highlightTradeIds', 'mistakeTradeIds', 'followUpTradeIds',
  ]) {
    if (!isStringArray(value[field])) return false
  }
  if (
    value.previousCommitmentResult !== null &&
    !WEEKLY_COMMITMENT_RESULTS.has(String(value.previousCommitmentResult))
  ) return false
  if (value.completedAt !== null && typeof value.completedAt !== 'string') return false
  return value.metricsSnapshot === null || isWeeklyReviewMetrics(value.metricsSnapshot)
}

function isQuickNote(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === 'string' && Boolean(value.id.trim()) &&
    typeof value.title === 'string' &&
    typeof value.contentHtml === 'string' &&
    typeof value.pinned === 'boolean' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
}

function isStrategy(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' && Boolean(value.id.trim()) &&
    typeof value.name === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.color === 'string'
  )
}

export function assertValidPersistedSnapshot(
  value: unknown,
  label = 'snapshot',
): asserts value is PersistedSnapshot {
  if (!isRecord(value) || !Array.isArray(value.trades) || !Array.isArray(value.strategies)) {
    throw new Error(`${label} is missing trades or strategies`)
  }
  if (!value.trades.every(isValidPersistedTrade)) throw new Error(`${label} contains an invalid trade`)
  if (!value.strategies.every(isStrategy)) throw new Error(`${label} contains an invalid strategy`)
  if (hasDuplicateStringId(value.trades)) throw new Error(`${label} contains duplicate trade ids`)
  if (value.weeklyReviews !== undefined) {
    if (!Array.isArray(value.weeklyReviews) || !value.weeklyReviews.every(isWeeklyReview)) {
      throw new Error(`${label} contains an invalid weekly review`)
    }
    if (hasDuplicateStringId(value.weeklyReviews)) {
      throw new Error(`${label} contains duplicate weekly review ids`)
    }
    const weeks = new Set<string>()
    for (const review of value.weeklyReviews) {
      if (weeks.has(review.weekStart)) throw new Error(`${label} contains duplicate weekly review weeks`)
      weeks.add(review.weekStart)
    }
  }
  if (value.quickNotes !== undefined) {
    if (!Array.isArray(value.quickNotes) || !value.quickNotes.every(isQuickNote)) {
      throw new Error(`${label} contains an invalid quick note`)
    }
    if (hasDuplicateStringId(value.quickNotes)) {
      throw new Error(`${label} contains duplicate quick note ids`)
    }
  }
  if (hasDuplicateStringId(value.strategies)) throw new Error(`${label} contains duplicate strategy ids`)
  if (!isDisplayPrefs(value.display)) throw new Error(`${label} contains invalid display settings`)
  if (!isReviewTemplates(value.reviewTemplates)) throw new Error(`${label} contains invalid review templates`)
  if (!isShortcutOverrides(value.shortcuts)) throw new Error(`${label} contains invalid shortcuts`)
  if (!isUserProfile(value.profile)) throw new Error(`${label} contains an invalid profile`)
  if (!isSavedTradeViews(value.savedTradeViews)) throw new Error(`${label} contains invalid saved trade views`)
  if (!isSymbolIcons(value.symbolIcons)) throw new Error(`${label} contains invalid symbol icons`)
  if (value.symbolCatalog !== undefined && !isStringArray(value.symbolCatalog)) {
    throw new Error(`${label}.symbolCatalog must be a string array`)
  }
  for (const field of ['starredIds', 'subscribedIds', 'pinnedStrategyIds']) {
    if (!isStringArray(value[field])) {
      throw new Error(`${label}.${field} must be a string array`)
    }
  }
  for (const field of ['tagPresets', 'mistakeTagPresets']) {
    if (value[field] !== undefined && !isStringArray(value[field])) {
      throw new Error(`${label}.${field} must be a string array`)
    }
  }
}

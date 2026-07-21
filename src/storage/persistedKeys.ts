import type { PersistedSnapshot } from '@/storage/types'

/**
 * Zustand 持久化字段的引用键列表。
 * Notion 导入 revision、JSON 导入 revision、bootstrap 订阅去抖共用同一套，避免分叉漏检。
 */
export const PERSISTED_STATE_REFERENCE_KEYS = [
  'trades',
  'weeklyReviews',
  'quickNotes',
  'strategies',
  'starredIds',
  'subscribedIds',
  'pinnedStrategyIds',
  'display',
  'tagPresets',
  'mistakeTagPresets',
  'profile',
  'savedTradeViews',
  'symbolIcons',
  'symbolCatalog',
  'reviewTemplates',
] as const satisfies readonly (keyof PersistedSnapshot)[]

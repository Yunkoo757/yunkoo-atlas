import type { PersistedSnapshot } from '@/storage/types'

export type DeprecatedPersistedSnapshotKey = 'cases' | 'disputeTypes'
export type ActivePersistedSnapshotKey = Exclude<keyof PersistedSnapshot, DeprecatedPersistedSnapshotKey>

/**
 * 完整快照合同。writer / reader 的合同测试必须遍历本清单，避免新增字段后静默漏写。
 * 已废弃的 cases / disputeTypes 仅允许读取时忽略，不属于活跃合同。
 */
export const PERSISTED_SNAPSHOT_FIELDS = [
  'trades',
  'weeklyReviews',
  'quickNotes',
  'strategies',
  'starredIds',
  'subscribedIds',
  'pinnedStrategyIds',
  'display',
  'shortcuts',
  'tagPresets',
  'mistakeTagPresets',
  'profile',
  'savedTradeViews',
  'symbolIcons',
  'symbolCatalog',
  'reviewTemplates',
] as const satisfies readonly ActivePersistedSnapshotKey[]

type MissingPersistedSnapshotKey = Exclude<
  ActivePersistedSnapshotKey,
  (typeof PERSISTED_SNAPSHOT_FIELDS)[number]
>
type AssertNoMissingPersistedSnapshotKey<T extends never> = T
export type PersistedSnapshotFieldsAreComplete = AssertNoMissingPersistedSnapshotKey<
  MissingPersistedSnapshotKey
>

/**
 * Zustand 持久化字段的引用键列表。
 * Notion 导入 revision、JSON 导入 revision、bootstrap 订阅去抖共用同一套，避免分叉漏检。
 */
export const PERSISTED_STATE_REFERENCE_KEYS = PERSISTED_SNAPSHOT_FIELDS.filter(
  (key): key is Exclude<ActivePersistedSnapshotKey, 'shortcuts'> => key !== 'shortcuts',
)

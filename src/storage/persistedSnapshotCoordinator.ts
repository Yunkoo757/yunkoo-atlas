import { PERSISTED_STATE_REFERENCE_KEYS } from '@/storage/persistedKeys'
import type { PersistedSnapshot } from '@/storage/types'

export interface PersistedSnapshotCoordinatorDependencies {
  capture(): PersistedSnapshot
  schedule(snapshot: PersistedSnapshot): void
}

export interface PersistedSnapshotCoordinator {
  observe(snapshot: PersistedSnapshot): void
  publishDurable(publish: () => void): void
}

function haveSameReferences(previous: PersistedSnapshot, next: PersistedSnapshot): boolean {
  return PERSISTED_STATE_REFERENCE_KEYS.every((key) => previous[key] === next[key])
}

/**
 * Store 从已经耐久化的完整快照刷新时，订阅只替换持久化基线，不再把该刷新当成新编辑。
 * 完成后任何真实编辑仍从刷新后的完整 Store 生成下一次快照。
 */
export function createPersistedSnapshotCoordinator(
  initial: PersistedSnapshot,
  dependencies: PersistedSnapshotCoordinatorDependencies,
): PersistedSnapshotCoordinator {
  let lastPersisted = initial
  let durablePublishDepth = 0

  return {
    observe(snapshot) {
      if (haveSameReferences(lastPersisted, snapshot)) return
      if (durablePublishDepth > 0) return
      lastPersisted = snapshot
      dependencies.schedule(snapshot)
    },
    publishDurable(publish) {
      durablePublishDepth += 1
      try {
        publish()
        lastPersisted = dependencies.capture()
      } finally {
        durablePublishDepth = Math.max(0, durablePublishDepth - 1)
      }
    },
  }
}

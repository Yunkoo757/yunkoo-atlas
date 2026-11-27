import { PERSISTED_STATE_REFERENCE_KEYS } from '@/storage/persistedKeys'
import { storedBindingsEqual } from '@/shortcuts/chords'
import type { PersistedSnapshot } from '@/storage/types'

export interface PersistedSnapshotCoordinatorDependencies {
  capture(): PersistedSnapshot
  schedule(snapshot: PersistedSnapshot): void
}

export interface PersistedSnapshotCoordinator {
  observeStore(state: PersistedSnapshot): void
  observeShortcuts(): void
  publishDurable(publish: () => void): void
}

export function haveSamePersistedReferences(previous: PersistedSnapshot, next: PersistedSnapshot): boolean {
  return PERSISTED_STATE_REFERENCE_KEYS.every((key) => previous[key] === next[key])
}

function haveSameShortcuts(previous: PersistedSnapshot['shortcuts'], next: PersistedSnapshot['shortcuts']): boolean {
  const previousBindings = previous ?? {}
  const nextBindings = next ?? {}
  const previousKeys = Object.keys(previousBindings).sort()
  const nextKeys = Object.keys(nextBindings).sort()
  return previousKeys.length === nextKeys.length && previousKeys.every((key, index) =>
    key === nextKeys[index] && storedBindingsEqual(previousBindings[key]!, nextBindings[key]!),
  )
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

  function schedule(snapshot: PersistedSnapshot): void {
    dependencies.schedule(snapshot)
    lastPersisted = snapshot
  }

  return {
    observeStore(state) {
      if (durablePublishDepth > 0 || haveSamePersistedReferences(lastPersisted, state)) return
      schedule(dependencies.capture())
    },
    observeShortcuts() {
      if (durablePublishDepth > 0) return
      const snapshot = dependencies.capture()
      if (!haveSameShortcuts(lastPersisted.shortcuts, snapshot.shortcuts)) schedule(snapshot)
    },
    publishDurable(publish) {
      const outermost = durablePublishDepth === 0
      durablePublishDepth += 1
      try {
        publish()
      } finally {
        durablePublishDepth = Math.max(0, durablePublishDepth - 1)
        if (outermost) lastPersisted = dependencies.capture()
      }
    },
  }
}

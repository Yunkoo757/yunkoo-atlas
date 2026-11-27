import { PERSISTED_STATE_REFERENCE_KEYS } from '@/storage/persistedKeys'
import { storedBindingsEqual } from '@/shortcuts/chords'
import type { PersistedSnapshot } from '@/storage/types'

export interface PersistedSnapshotCoordinatorDependencies {
  capture(): PersistedSnapshot
  schedule(snapshot: PersistedSnapshot): void
}

export interface PersistedSnapshotCoordinator {
  observe(snapshot: PersistedSnapshot, observation: PersistedSnapshotObservation): void
  publishDurable(publish: () => void): void
}

export type PersistedSnapshotObservation =
  | { source: 'store' }
  | { source: 'shortcuts' }

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
  let lastShortcuts = initial.shortcuts
  let durablePublishDepth = 0

  return {
    observe(snapshot, observation) {
      if (durablePublishDepth > 0) return
      if (observation.source === 'shortcuts') {
        if (haveSameShortcuts(lastShortcuts, snapshot.shortcuts)) return
        dependencies.schedule(snapshot)
        lastShortcuts = snapshot.shortcuts
      } else {
        if (haveSamePersistedReferences(lastPersisted, snapshot)) return
        dependencies.schedule(snapshot)
        lastPersisted = snapshot
      }
    },
    publishDurable(publish) {
      const outermost = durablePublishDepth === 0
      durablePublishDepth += 1
      try {
        publish()
      } finally {
        durablePublishDepth = Math.max(0, durablePublishDepth - 1)
        if (outermost) {
          lastPersisted = dependencies.capture()
          lastShortcuts = lastPersisted.shortcuts
        }
      }
    },
  }
}

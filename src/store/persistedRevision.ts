import { PERSISTED_STATE_REFERENCE_KEYS } from '@/storage/persistedKeys'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

/** 异步提交前捕获持久字段与快捷键引用，判断等待期间是否发生本地编辑。 */
export interface PersistedStateRevision {
  state: ReturnType<typeof useStore.getState>
  shortcutBindings: ReturnType<typeof useShortcutStore.getState>['bindings']
  references: readonly unknown[]
}

export function capturePersistedStateRevision(): PersistedStateRevision {
  const state = useStore.getState()
  const shortcutBindings = useShortcutStore.getState().bindings
  return {
    state,
    shortcutBindings,
    references: [
      ...PERSISTED_STATE_REFERENCE_KEYS.map((key) => state[key]),
      shortcutBindings,
    ],
  }
}

export function hasSamePersistedStateRevision(
  previous: PersistedStateRevision,
  next: PersistedStateRevision,
): boolean {
  return previous.references.every((value, index) => value === next.references[index])
}

import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import {
  createPersistedSnapshotCoordinator,
  type PersistedSnapshotCoordinator,
} from '@/storage/persistedSnapshotCoordinator'
import type { PersistedSnapshot } from '@/storage/types'
import type { ShortcutBinding } from '@/shortcuts/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function bindingKey(binding: ShortcutBinding | null | undefined): string | null {
  return binding && !Array.isArray(binding) ? binding.key : null
}

type Observation =
  | { source: 'store' }
  | { source: 'shortcuts' }

function observe(
  coordinator: PersistedSnapshotCoordinator,
  snapshot: PersistedSnapshot,
  observation: Observation,
): void {
  const observeWithSource = coordinator.observe as unknown as (
    value: PersistedSnapshot,
    source: Observation,
  ) => void
  observeWithSource(snapshot, observation)
}

function initialSnapshot(): PersistedSnapshot {
  const snapshot = createEmptyPersistedSnapshot()
  snapshot.tagPresets = ['权威标签']
  snapshot.shortcuts = {
    'global.newTrade': { key: 't', alt: true },
  }
  return snapshot
}

function createHarness(initial = initialSnapshot()) {
  let current = initial
  const scheduled: PersistedSnapshot[] = []
  const coordinator = createPersistedSnapshotCoordinator(initial, {
    capture: () => current,
    schedule: (snapshot) => { scheduled.push(structuredClone(snapshot)) },
  })
  return {
    coordinator,
    scheduled,
    current: () => current,
    replace: (snapshot: PersistedSnapshot) => { current = snapshot },
  }
}

export function testDurableRefreshSuppressesStoreAndShortcutAutosaves(): void {
  const harness = createHarness()
  const refreshed = {
    ...harness.current(),
    tagPresets: ['主进程刷新标签'],
    shortcuts: { 'global.newTrade': { key: 'n', mod: true } },
  }
  harness.coordinator.publishDurable(() => {
    harness.replace(refreshed)
    observe(harness.coordinator, refreshed, { source: 'store' })
    observe(harness.coordinator, refreshed, { source: 'shortcuts' })
  })
  observe(harness.coordinator, refreshed, { source: 'store' })
  observe(
    harness.coordinator,
    { ...refreshed, shortcuts: structuredClone(refreshed.shortcuts) },
    { source: 'shortcuts' },
  )
  assert(harness.scheduled.length === 0, 'authoritative Store and shortcuts refresh must not autosave')
}

export function testShortcutOnlyEditSchedulesOneFullAuthoritativeSnapshot(): void {
  const harness = createHarness()
  const changed = {
    ...harness.current(),
    shortcuts: { 'global.newTrade': { key: 'n', mod: true } },
  }
  harness.replace(changed)
  observe(harness.coordinator, changed, { source: 'shortcuts' })
  observe(
    harness.coordinator,
    { ...changed, shortcuts: structuredClone(changed.shortcuts) },
    { source: 'shortcuts' },
  )
  assert(harness.scheduled.length === 1, 'shortcut-only edit must schedule exactly once')
  assert(harness.scheduled[0]?.tagPresets?.[0] === '权威标签', 'shortcut save must include the full Store baseline')
  assert(
    bindingKey(harness.scheduled[0]?.shortcuts?.['global.newTrade']) === 'n',
    'shortcut save must include the new valid binding',
  )
}

export function testStoreOnlyEditStillSchedulesWithoutShortcutDuplication(): void {
  const harness = createHarness()
  const changed = { ...harness.current(), starredIds: ['trade-later'] }
  harness.replace(changed)
  observe(harness.coordinator, changed, { source: 'store' })
  assert(harness.scheduled.length === 1, 'Store-only edit must schedule exactly once')
  assert(harness.scheduled[0]?.starredIds[0] === 'trade-later', 'scheduled snapshot must include the Store edit')
  assert(
    bindingKey(harness.scheduled[0]?.shortcuts?.['global.newTrade']) === 't',
    'Store-only save must retain authoritative shortcuts without a second shortcut schedule',
  )
}

export function testNestedOrThrowingDurableRefreshNeverLeavesPermanentSilence(): void {
  const harness = createHarness()
  let threw = false
  try {
    harness.coordinator.publishDurable(() => {
      harness.coordinator.publishDurable(() => {
        const nested = { ...harness.current(), tagPresets: ['嵌套刷新'] }
        harness.replace(nested)
        observe(harness.coordinator, nested, { source: 'store' })
      })
      const stillOuter = { ...harness.current(), starredIds: ['刷新期间'] }
      harness.replace(stillOuter)
      observe(harness.coordinator, stillOuter, { source: 'store' })
      throw new Error('injected publish failure')
    })
  } catch {
    threw = true
  }
  assert(threw, 'fixture must exercise the throwing durable refresh path')
  assert(harness.scheduled.length === 0, 'nested/throwing durable refresh must remain suppressed while active')

  const shortcutEdit = {
    ...harness.current(),
    shortcuts: { 'global.newTrade': { key: 'r', shift: true } },
  }
  harness.replace(shortcutEdit)
  observe(harness.coordinator, shortcutEdit, { source: 'shortcuts' })
  const storeEdit = { ...shortcutEdit, subscribedIds: ['strategy-later'] }
  harness.replace(storeEdit)
  observe(harness.coordinator, storeEdit, { source: 'store' })
  assert(Number(harness.scheduled.length) === 2, 'shortcut and Store edits after an exception must both resume persistence')
}

export function testScheduleFailureDoesNotAdvanceStoreOrShortcutBaseline(): void {
  for (const source of ['store', 'shortcuts'] as const) {
    const initial = initialSnapshot()
    const changed = source === 'store'
      ? { ...initial, pinnedStrategyIds: ['strategy-retry'] }
      : { ...initial, shortcuts: { 'global.newTrade': { key: 'r', shift: true } } }
    let attempts = 0
    const coordinator = createPersistedSnapshotCoordinator(initial, {
      capture: () => changed,
      schedule: () => {
        attempts += 1
        if (attempts === 1) throw new Error('injected schedule failure')
      },
    })
    try { observe(coordinator, changed, { source }) } catch { /* retry below */ }
    observe(coordinator, changed, { source })
    assert(attempts === 2, `${source} observation must retry after a schedule exception`)
  }
}

export function testThrowingPartialRefreshRebasesBeforeShortcutRevert(): void {
  const initial = initialSnapshot()
  const harness = createHarness(initial)
  const partiallyRefreshed = {
    ...initial,
    shortcuts: { 'global.newTrade': { key: 'n', mod: true } },
  }

  try {
    harness.coordinator.publishDurable(() => {
      harness.replace(partiallyRefreshed)
      observe(harness.coordinator, partiallyRefreshed, { source: 'shortcuts' })
      throw new Error('injected partial refresh failure')
    })
  } catch { /* user may continue editing the in-memory state */ }

  assert(harness.scheduled.length === 0, 'partial durable refresh must remain suppressed')
  const reverted = {
    ...partiallyRefreshed,
    shortcuts: structuredClone(initial.shortcuts),
  }
  harness.replace(reverted)
  observe(harness.coordinator, reverted, { source: 'shortcuts' })
  assert(
    Number(harness.scheduled.length) === 1,
    'reverting a partially refreshed shortcut to the pre-refresh value must persist',
  )
  assert(
    bindingKey(harness.scheduled[0]?.shortcuts?.['global.newTrade']) === 't',
    'the persisted retry must contain the user-reverted shortcut',
  )
}

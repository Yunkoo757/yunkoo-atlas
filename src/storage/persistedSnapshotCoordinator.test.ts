import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import { createPersistedSnapshotCoordinator } from '@/storage/persistedSnapshotCoordinator'
import type { PersistedSnapshot } from '@/storage/types'
import type { ShortcutBinding } from '@/shortcuts/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function bindingKey(binding: ShortcutBinding | null | undefined): string | null {
  return binding && !Array.isArray(binding) ? binding.key : null
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
    observeStore(snapshot: PersistedSnapshot) {
      current = snapshot
      coordinator.observeStore(snapshot)
    },
    observeShortcuts(snapshot: PersistedSnapshot) {
      current = snapshot
      coordinator.observeShortcuts()
    },
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
    harness.observeStore(refreshed)
    harness.observeShortcuts(refreshed)
  })
  harness.observeStore(refreshed)
  harness.observeShortcuts({ ...refreshed, shortcuts: structuredClone(refreshed.shortcuts) })
  assert(harness.scheduled.length === 0, 'authoritative Store and shortcuts refresh must not autosave')
}

export function testEquivalentModifiersDoNotWriteAndSequenceOrderStillMatters(): void {
  const first = initialSnapshot()
  first.shortcuts = { 'nav.list': [{ key: 'a' }, { key: 'b' }] }
  const { observeShortcuts, scheduled } = createHarness(first)
  const observeBinding = (binding: ShortcutBinding | null) => observeShortcuts({
    ...first, shortcuts: { 'nav.list': binding },
  })
  observeBinding([{ alt: false, key: 'a' }, { key: 'b', shift: false }])
  assert(scheduled.length === 0, '省略和关闭修饰键含义相同，不应触发自动保存')
  observeBinding([{ key: 'b' }, { key: 'a' }])
  observeBinding([{ key: 'a' }])
  observeBinding({ key: 'a' })
  observeBinding(null)
  observeBinding(null)
  assert(Number(scheduled.length) === 4, '顺序、长度、触发方式和禁用各应保存一次')
}

export function testShortcutExtensionOnlyEditsArePersisted(): void {
  const first = initialSnapshot()
  const original = { key: 'a', extension: { label: '旧数据' } }
  first.shortcuts = { 'nav.list': original }
  const { observeShortcuts, scheduled } = createHarness(first)
  for (const label of ['旧数据', '新数据']) {
    const chord = { key: 'a', extension: { label } }
    observeShortcuts({ ...first, shortcuts: { 'nav.list': chord } })
  }
  assert(scheduled.length === 1, '扩展字段未变时跳过，扩展值变化时保留用户数据')
}

export function testShortcutOnlyEditSchedulesOneFullAuthoritativeSnapshot(): void {
  const harness = createHarness()
  const changed = {
    ...harness.current(),
    shortcuts: { 'global.newTrade': { key: 'n', mod: true } },
  }
  harness.observeShortcuts(changed)
  harness.observeShortcuts({ ...changed, shortcuts: structuredClone(changed.shortcuts) })
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
  harness.observeStore(changed)
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
        harness.observeStore(nested)
      })
      const stillOuter = { ...harness.current(), starredIds: ['刷新期间'] }
      harness.observeStore(stillOuter)
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
  harness.observeShortcuts(shortcutEdit)
  const storeEdit = { ...shortcutEdit, subscribedIds: ['strategy-later'] }
  harness.observeStore(storeEdit)
  assert(Number(harness.scheduled.length) === 2, 'shortcut and Store edits after an exception must both resume persistence')
}

export function testOneFullCaptureCoversChangesFromBothSubscriptions(): void {
  for (const first of ['store', 'shortcuts'] as const) {
    const harness = createHarness()
    const changed = {
      ...harness.current(),
      tagPresets: ['同时修改'],
      shortcuts: { 'nav.list': { key: 'q' } },
    }
    const notifications = first === 'store'
      ? [harness.observeStore, harness.observeShortcuts]
      : [harness.observeShortcuts, harness.observeStore]
    for (const notify of notifications) notify(changed)
    assert(harness.scheduled.length === 1, `两处变更都在首份快照中，${first} 先通知时实际调度 ${harness.scheduled.length} 次`)
    assert(harness.scheduled[0]?.tagPresets?.[0] === '同时修改', '首份保存包含最新标签')
    assert(bindingKey(harness.scheduled[0]?.shortcuts?.['nav.list']) === 'q', '首份保存包含最新快捷键')
  }
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
    const notify = source === 'store' ? () => coordinator.observeStore(changed) : coordinator.observeShortcuts
    try { notify() } catch { /* retry below */ }
    notify()
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
      harness.observeShortcuts(partiallyRefreshed)
      throw new Error('injected partial refresh failure')
    })
  } catch { /* user may continue editing the in-memory state */ }

  assert(harness.scheduled.length === 0, 'partial durable refresh must remain suppressed')
  const reverted = {
    ...partiallyRefreshed,
    shortcuts: structuredClone(initial.shortcuts),
  }
  harness.observeShortcuts(reverted)
  assert(
    Number(harness.scheduled.length) === 1,
    'reverting a partially refreshed shortcut to the pre-refresh value must persist',
  )
  assert(
    bindingKey(harness.scheduled[0]?.shortcuts?.['global.newTrade']) === 't',
    'the persisted retry must contain the user-reverted shortcut',
  )
}

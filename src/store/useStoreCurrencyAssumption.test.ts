import assert from 'node:assert/strict'
import { useStore } from '@/store/useStore'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import type { PersistedSnapshot } from '@/storage/types'
import { useShortcutStore } from '@/store/shortcutStore'

type CurrencyAssumptionAction = (
  confirmed: boolean,
  dependencies: {
    now: () => string
    persistSnapshot: (snapshot: PersistedSnapshot) => Promise<void>
    boundary: {
      lockInteraction: () => () => void
      flushBeforeCommit: () => Promise<void>
      suspendPersist: () => void
      resumePersist: () => void
      discardPendingAndResumePersist: () => void
    }
  },
) => Promise<void>

function action(): CurrencyAssumptionAction {
  return (useStore.getState() as unknown as {
    setLegacyCashCurrencyAssumption: CurrencyAssumptionAction
  }).setLegacyCashCurrencyAssumption
}

function dependencies(persistSnapshot: (snapshot: PersistedSnapshot) => Promise<void>) {
  return {
    now: () => '2026-08-09T04:00:00.000Z',
    persistSnapshot,
    boundary: {
      lockInteraction: () => () => undefined,
      flushBeforeCommit: async () => undefined,
      suspendPersist: () => undefined,
      resumePersist: () => undefined,
      discardPendingAndResumePersist: () => undefined,
    },
  }
}

export async function testCashCurrencyAssumptionPublishesOnlyAfterDurableCommit(): Promise<void> {
  const previous = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  let resolveCommit: (() => void) | undefined
  let persisted: PersistedSnapshot | null = null
  try {
    useStore.setState({
      ...createEmptyPersistedSnapshot(),
      profile: {
        avatarId: null,
        displayName: 'Yunkoo',
        customAvatarDataUrl: null,
        legacyCashCurrencyAssumption: null,
      },
    })
    useShortcutStore.setState({
      bindings: { 'nav.dashboard': { mod: true, key: 'z' } },
    })
    const pending = action()(true, dependencies((snapshot) => new Promise<void>((resolve) => {
      persisted = snapshot
      resolveCommit = resolve
    })))

    for (let attempt = 0; attempt < 20 && !resolveCommit; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    assert(resolveCommit, '测试必须观察到真实持久化调用')
    assert.equal(useStore.getState().profile.legacyCashCurrencyAssumption, null, 'commit 返回前不得假成功发布')
    resolveCommit?.()
    await pending
    assert.deepEqual(useStore.getState().profile.legacyCashCurrencyAssumption, {
      currency: 'USD',
      confirmedAt: '2026-08-09T04:00:00.000Z',
    })
    const committed = persisted as unknown as PersistedSnapshot
    assert.deepEqual(committed.profile?.legacyCashCurrencyAssumption, useStore.getState().profile.legacyCashCurrencyAssumption)
    assert.deepEqual(committed.shortcuts?.['nav.dashboard'], { mod: true, key: 'z' }, '资料确认不得擦除现有快捷键设置')
  } finally {
    useStore.setState(previous, true)
    useShortcutStore.setState(previousShortcuts, true)
  }
}

export async function testCashCurrencyAssumptionFailureAndRevocationStayTruthful(): Promise<void> {
  const previous = useStore.getState()
  try {
    useStore.setState({
      ...createEmptyPersistedSnapshot(),
      profile: {
        avatarId: null,
        displayName: 'Yunkoo',
        customAvatarDataUrl: null,
        legacyCashCurrencyAssumption: null,
      },
    })
    await assert.rejects(
      action()(true, dependencies(async () => { throw new Error('disk full') })),
      /disk full/,
    )
    assert.equal(useStore.getState().profile.legacyCashCurrencyAssumption, null, '持久化失败不得显示已确认')

    await action()(true, dependencies(async () => undefined))
    let revokedSnapshot: PersistedSnapshot | null = null
    await action()(false, dependencies(async (snapshot) => { revokedSnapshot = snapshot }))
    assert.equal(useStore.getState().profile.legacyCashCurrencyAssumption, null, '撤销成功后必须立即发布 null')
    const revoked = revokedSnapshot as unknown as PersistedSnapshot
    assert.equal(revoked.profile?.legacyCashCurrencyAssumption, null, '撤销必须先持久化 null')
  } finally {
    useStore.setState(previous, true)
  }
}

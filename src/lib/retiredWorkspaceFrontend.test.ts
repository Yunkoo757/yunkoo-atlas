import assert from 'node:assert/strict'
import { normalizePrimarySidebarOrder, PRIMARY_NAV_ITEMS } from './sidebarNavContract'
import { normalizeSidebarWorkspaceItems } from './sidebarWorkspace'
import { resolveTradeDetailReturn } from './tradeRoute'
import { resolveTradeDetailSourceCopy } from '@/views/detailSourceCopy'
import { SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { migrateShortcutBindings } from '@/shortcuts/migrate'
import { handleShortcutKeydown, registerShortcutHandlers } from '@/shortcuts/engine'
import { bindingsForPersist, useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

export function testRetiredWorkspacesCannotReturnThroughOldNavigationPreferences(): void {
  assert.deepEqual(normalizePrimarySidebarOrder(['judgmentDesk', 'reviewComposer', 'reviewSession']), ['reviewSession', 'trades', 'dashboard', 'weeklyReview', 'reviewCases'])
  assert.deepEqual(PRIMARY_NAV_ITEMS.map(item => item.to), ['/list', '/dashboard', '/weekly-review', '/review-cases', '/review-session'])
  assert.deepEqual(normalizeSidebarWorkspaceItems(['judgmentDesk', 'reviewComposer'].map((id, order) => ({ id, target: { kind: 'system', id }, placement: 'pinned', order }))), [])
  for (const pathname of ['/judgment-desk', '/review-composer', '/settings/composer-rules']) {
    const target = resolveTradeDetailReturn({ from: { pathname }, tradeKind: 'case' })
    assert.deepEqual(target, { pathname: '/review-cases', search: '' })
    assert.equal(resolveTradeDetailSourceCopy({ returnPathname: target.pathname, tradeKind: 'case' }).breadcrumb, '案例库')
  }
}

export function testRetiredShortcutOverridesCannotConsumeJOrR(): void {
  const bindings = { 'nav.judgmentDesk': { key: 'j' }, 'judgment.yes': { key: '1' }, 'nav.reviewComposer': { key: 'r' }, 'nav.list': { key: 'j' } }
  const migrated = migrateShortcutBindings(bindings)
  assert.deepEqual(migrated, { 'nav.list': { key: 'j' } })
  assert.deepEqual(bindingsForPersist(bindings), migrated)
  assert(!SHORTCUT_ACTIONS.some(action => action.id.startsWith('judgment.') || action.id === 'nav.judgmentDesk' || action.id === 'nav.reviewComposer'))
  const previous = useShortcutStore.getState(), state = useStore.getState()
  let activeCalls = 0, retiredCalls = 0
  const unregister = registerShortcutHandlers({ 'nav.list': () => { activeCalls++ }, 'nav.judgmentDesk': () => { retiredCalls++ }, 'nav.reviewComposer': () => { retiredCalls++ } })
  const event = (key: string, defaultPrevented = false) => ({ key, defaultPrevented, repeat: false, isComposing: false, keyCode: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: null, preventDefault() {} }) as unknown as KeyboardEvent
  try {
    useShortcutStore.setState({ bindings: migrated, lightbox: null, cmdkOpen: false, modalOverlayCount: 0 })
    useStore.setState({ composerOpen: false, closeTradeRequest: null })
    assert.equal(handleShortcutKeydown(event('r'), '/list'), false)
    handleShortcutKeydown(event('r', true), '/list')
    assert.equal(handleShortcutKeydown(event('j'), '/list'), true)
    assert.equal(activeCalls, 1)
    assert.equal(retiredCalls, 0)
  } finally {
    handleShortcutKeydown(event('r', true), '/list')
    unregister()
    useShortcutStore.setState(previous, true)
    useStore.setState(state, true)
  }
}

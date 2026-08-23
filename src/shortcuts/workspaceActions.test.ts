import type { DisplayPrefs } from '@/lib/tradeFilters'
import { resolveShortcutWorkspaceHref } from '@/shortcuts/workspaceActions'
import { getActionMeta } from '@/shortcuts/actions'
import { bindingKey } from '@/shortcuts/chords'
import { useStore } from '@/store/useStore'
import { bindingsForPersist, useShortcutStore } from '@/store/shortcutStore'
import { getShortcutHintModel } from '@/shortcuts/hints'
import { newTradeKindForPath } from '@/lib/tradeKind'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const display: DisplayPrefs = {
  hideClosed: false,
  showEmptyGroups: false,
  groupByStrategy: false,
  groupByDate: true,
  sortBy: 'date',
  privacyMode: false,
  showKeyboardFocusRings: false,
  tradingDayStartHour: 6,
  sidebarPins: [],
  sidebarWorkspaceItems: [],
  workspaceMemory: {
    trade: { pathname: '/period/this-week', search: '?symbol=BTCUSDT' },
    case: { pathname: '/review-cases/mistakes', search: '?tag=执行' },
  },
}

export function testTradeShortcutOpensAllWhileCaseShortcutRemembersWorkspace(): void {
  assert(
    resolveShortcutWorkspaceHref('trade', display, []) === '/list',
    '交易快捷键应始终回到交易日志全部视图',
  )
  assert(
    resolveShortcutWorkspaceHref('case', display, []) ===
      '/review-cases/mistakes?tag=执行',
    '案例快捷键应恢复案例工作区上次使用的位置',
  )
}

export function testTradeAndCaseShortcutsHaveSeparateConfigurableBindings(): void {
  const trade = getActionMeta('nav.list')
  const reviewCases = getActionMeta('nav.reviewCases')
  assert(trade?.label === '交易日志', '交易工作区动作应使用稳定名称')
  assert(reviewCases?.label === '案例记录', '案例工作区应有独立动作')
  assert(bindingKey(trade!.defaultBinding) === 'alt+w', '交易日志默认快捷键应为 Alt+W')
  assert(bindingKey(reviewCases!.defaultBinding) === 'alt+c', '案例记录默认快捷键应为 Alt+C')
  assert(!getActionMeta('global.switchModule'), '不应继续暴露结果不稳定的模块切换动作')
}

export function testTradeDetailNavigationKeepsQForPreviousAndEForNext(): void {
  assert(
    bindingKey(getActionMeta('trade.prev')!.defaultBinding) === 'q',
    '交易详情上一条默认快捷键应保持 Q',
  )
  assert(
    bindingKey(getActionMeta('trade.next')!.defaultBinding) === 'e',
    '交易详情下一条默认快捷键应保持 E',
  )
}

export function testNewTradeAndCaseActionsChooseTheirRecordKindExplicitly(): void {
  const previous = useStore.getState()
  try {
    previous.openComposer(null, 'case')
    assert(useStore.getState().composerKind === 'case', '新建案例动作应显式选择案例类型')
    useStore.getState().closeComposer()
    assert(useStore.getState().composerKind === null, '关闭新建窗口后应清除类型覆盖')
    useStore.getState().openComposer(null, 'live')
    assert(useStore.getState().composerKind === 'live', '新建交易动作应显式选择实盘类型')
    assert(newTradeKindForPath('/sim') === 'paper', '模拟工作区的新建交易应保持模拟类型')
    assert(
      newTradeKindForPath('/list', '?kind=paper') === 'paper' &&
        newTradeKindForPath('/list', '?source=paper') === 'paper',
      '模拟工作区归一到交易日志路由后仍应保持模拟类型',
    )
    assert(newTradeKindForPath('/review-cases') === 'live', '新建交易动作不应被案例页面改成案例类型')
  } finally {
    useStore.setState({
      composerOpen: previous.composerOpen,
      composerTrade: previous.composerTrade,
      composerKind: previous.composerKind,
    })
  }
}

export function testNewCaseHasAnIndependentConfigurableShortcut(): void {
  const action = getActionMeta('global.newCase')
  assert(action?.label === '新建案例记录', '案例记录应有独立的新建动作')
  assert(bindingKey(action!.defaultBinding) === 'shift+n', '新建案例记录默认快捷键应为 Shift+N')
}

export function testOmittedPrimaryNavigationActionsAreConfigurable(): void {
  const expected = new Map([
    ['nav.today', 'alt+t'],
    ['nav.quickNotes', 'alt+n'],
    ['nav.weeklyReview', 'alt+4'],
    ['nav.reviewSession', 'alt+6'],
    ['view.board', 'b'],
    ['list.toggleFilters', 'f'],
  ])
  for (const [id, binding] of expected) {
    const action = getActionMeta(id)
    assert(Boolean(action), `${id} 应出现在快捷键设置中`)
    assert(bindingKey(action!.defaultBinding) === binding, `${id} 应使用默认快捷键 ${binding}`)
  }
}

export function testQuickNotesHaveIndependentNavigationAndCreateShortcuts(): void {
  assert(
    bindingKey(getActionMeta('nav.quickNotes')!.defaultBinding) === 'alt+n',
    '随记导航默认快捷键应为 Alt+N',
  )
  assert(
    bindingKey(getActionMeta('global.newQuickNote')!.defaultBinding) === 'shift+alt+n',
    '新建随记默认快捷键应为 Alt+Shift+N',
  )
}

export function testFullscreenHasAConfigurableF11Default(): void {
  const action = getActionMeta('global.toggleFullscreen')
  assert(action?.label === '切换应用全屏', '应用全屏应出现在快捷键设置中')
  assert(bindingKey(action!.defaultBinding) === 'f11', '应用全屏默认快捷键应为 F11')
}

export function testShortcutHintsReflectCustomAndDisabledBindings(): void {
  const custom = getShortcutHintModel('global.newTrade', {
    'global.newTrade': { alt: true, key: 'x' },
  })
  assert(custom.hint === 'Alt+X', '悬停提示应显示用户当前的自定义绑定')
  assert(custom.ariaLabel === '新建交易（Alt+X）', '无障碍名称应包含当前绑定')

  const disabled = getShortcutHintModel('global.newTrade', {
    'global.newTrade': null,
  })
  assert(disabled.hint === null, '禁用快捷键后不应回退显示旧默认键')
  assert(disabled.ariaLabel === '新建交易（未设置快捷键）', '禁用状态应明确说明未设置')
}

export function testLegacyModuleShortcutMigratesToTradeWorkspace(): void {
  const previousBindings = useShortcutStore.getState().bindings
  try {
    useShortcutStore.getState().hydrateBindings({
      'global.switchModule': { alt: true, key: 'x' },
    })
    const migrated = useShortcutStore.getState().bindings
    assert(bindingKey(migrated['nav.list']!) === 'alt+x', '旧模块切换绑定应迁移到交易工作区')
    assert(!('global.switchModule' in migrated), '迁移后不应继续保存废弃动作')
  } finally {
    useShortcutStore.getState().hydrateBindings(previousBindings)
  }
}

export function testWindowHotkeyDisablesConflictingOrdinaryShortcut(): void {
  const previousBindings = useShortcutStore.getState().bindings
  try {
    useShortcutStore.setState({ bindings: {} })
    const clearedLabels = useShortcutStore.getState().disableConflictsWithWindowHotkey({
      mod: true,
      key: 'k',
    })
    const bindings = useShortcutStore.getState().bindings

    assert(bindings['global.commandPaletteMod'] === null, '系统键应禁用冲突的普通快捷键')
    assert(clearedLabels.includes('命令面板（Ctrl+K）'), '应返回被禁用动作的名称')
    assert(
      !('app.toggleWindow' in bindingsForPersist(bindings)),
      '系统窗口热键不得写入普通快捷键资料库',
    )
  } finally {
    useShortcutStore.setState({ bindings: previousBindings })
  }
}

export function testResetDefaultsKeepsSystemConflictDisabled(): void {
  const previousBindings = useShortcutStore.getState().bindings
  try {
    useShortcutStore.setState({ bindings: { 'list.toggleFilters': { alt: true, key: 'f' } } })
    const clearedLabels = useShortcutStore.getState().resetAllBindingsForWindowHotkey({ key: 'f' })
    const bindings = useShortcutStore.getState().bindings

    assert(bindings['list.toggleFilters'] === null, '恢复默认不能抢占系统热键')
    assert(clearedLabels.includes('打开或关闭筛选器'), '恢复时应报告被保留禁用的动作')
  } finally {
    useShortcutStore.setState({ bindings: previousBindings })
  }
}

export function testHydrationDisablesActiveSystemHotkeyConflict(): void {
  const previous = useShortcutStore.getState().bindings
  try {
    useShortcutStore.getState().setWindowHotkeyState({ binding: { mod: true, key: 'k' }, registered: true })
    const cleared = useShortcutStore.getState().hydrateBindings({})
    assert(cleared.includes('命令面板（Ctrl+K）'), '水合必须协调全部 scope 的系统热键冲突')
    assert(useShortcutStore.getState().bindings['global.commandPaletteMod'] === null, '系统热键必须优先并产生 null 覆盖')
    useShortcutStore.getState().hydrateBindings({ 'global.commandPaletteMod': { mod: true, key: 'k' } })
    assert(useShortcutStore.getState().bindings['global.commandPaletteMod'] === null, '切库后的再次水合必须重新协调冲突')
    useShortcutStore.getState().hydrateBindings({})
    assert(bindingsForPersist(useShortcutStore.getState().bindings)['global.commandPaletteMod'] === null, '导入/水合协调结果必须进入普通持久化快照')
  } finally {
    useShortcutStore.getState().setWindowHotkeyState(null)
    useShortcutStore.setState({ bindings: previous })
  }
}

export function testUnregisteredWindowHotkeyDoesNotDisableHydratedBindings(): void {
  const previous = useShortcutStore.getState().bindings
  try {
    useShortcutStore.getState().setWindowHotkeyState({ binding: { mod: true, key: 'k' }, registered: false })
    const cleared = useShortcutStore.getState().hydrateBindings({})
    assert(cleared.length === 0, '未注册系统热键不得参与冲突协调')
    assert(!('global.commandPaletteMod' in useShortcutStore.getState().bindings), '未注册系统热键不得写入 null 覆盖')
  } finally {
    useShortcutStore.getState().setWindowHotkeyState(null)
    useShortcutStore.setState({ bindings: previous })
  }
}

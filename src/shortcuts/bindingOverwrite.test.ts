import { bindingsForPersist, buildBindingOverwritePatch, findBindingConflicts, resolveBinding } from '@/shortcuts/bindingRules'
import { SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { migrateShortcutBindings } from '@/shortcuts/migrate'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testShortcutExportOnlyKeepsEffectiveOverrides(): void {
  const reordered = bindingsForPersist({ 'global.commandPalette': { key: 'k', mod: true } })
  assert(!('global.commandPalette' in reordered), '属性顺序不同的默认组合键不应写为覆盖')
  const withExtension = { key: 'n', extension: { label: '历史格式' } }
  assert(bindingsForPersist({ 'global.newTrade': withExtension })['global.newTrade'] === withExtension, '备份保留扩展字段')
  const sequence = [{ key: 'a' }]
  const persisted = bindingsForPersist({
    'global.newTrade': { alt: false, key: 'n' },
    'global.toggleSidebar': null,
    'nav.list': sequence,
    'image.close': { shift: true, key: 'escape' },
  })
  assert(!('global.newTrade' in persisted), '显式 false 的默认按键不应写为覆盖')
  assert(persisted['global.toggleSidebar'] === null, '显式禁用必须保留')
  assert(persisted['nav.list'] === sequence, '单步序列与单键的触发方式不同')
  assert('image.close' in persisted, '启用修饰键必须保留')
}

export function testNewSidebarDefaultRespectsExistingBracketBinding(): void {
  const old = { 'view.board': { key: '[' } }
  const migrated = migrateShortcutBindings(old)
  assert(migrated['view.board'] === old['view.board'], '应沿用旧资料库中占用方括号的动作')
  assert(resolveBinding('global.toggleSidebar', migrated) === null, '新增动作不得抢占已有按键')
  const custom = { key: ']', shift: true }
  const rebound = migrateShortcutBindings({ ...old, 'global.toggleSidebar': custom })
  assert(rebound['global.toggleSidebar'] === custom, '再次打开应保留自定义的侧栏快捷键')
}

export function testBindingOverwriteClearsConflictingAction(): void {
  const target = SHORTCUT_ACTIONS.find((a) => a.id === 'image.reset')
  const other = SHORTCUT_ACTIONS.find((a) => a.id === 'image.close')
  assert(target && other, '需要 image.reset / image.close 动作')

  const shared = { alt: true, key: 'r' }
  const bindings = { 'image.close': shared }

  const conflicts = findBindingConflicts('image.reset', shared, {
    ...bindings,
    'image.reset': shared,
  })
  assert(conflicts.some((c) => c.id === 'image.close'), '应检出与关闭预览冲突')

  const result = buildBindingOverwritePatch('image.reset', shared, bindings)
  assert(!('error' in result), '可覆盖冲突不应报错')
  if ('error' in result) return
  assert(result.patch['image.reset'] === shared, '应写入新绑定')
  assert(result.patch['image.close'] === null, '应清空冲突方绑定')
  assert(result.clearedLabels.includes(`图片查看器 · ${other!.label}`), '应记录被覆盖动作所属范围和名称')

  const nextBindings = { ...bindings, ...result.patch }
  assert(resolveBinding('image.reset', nextBindings) !== null, 'reset 应生效')
  assert(resolveBinding('image.close', nextBindings) === null, 'close 应被禁用')
}

export function testBindingOverwriteCanStealDefaultChord(): void {
  // image.close 默认 Esc；把 Esc 赋给 image.reset 时应禁用 close
  const escape = { key: 'escape' }
  const result = buildBindingOverwritePatch('image.reset', escape, {})
  assert(!('error' in result), '覆盖默认 Esc 应允许')
  if ('error' in result) return
  assert(result.patch['image.reset'] !== undefined, '应写入 reset')
  assert(
    result.clearedLabels.length > 0,
    '应至少覆盖一个默认占用 Esc 的动作',
  )
  assert(result.patch['image.close'] === null, '默认 Esc 的关闭预览应被清空')
}

export function testBindingConflictsIgnoreDifferentScopes(): void {
  const shared = { key: 'q' }
  const conflicts = findBindingConflicts('list.focusNext', shared, {
    'trade.prev': shared,
    'list.focusNext': shared,
  })
  assert(
    !conflicts.some((item) => item.id === 'trade.prev'),
    '详情与列表分属不同作用域时，复用 q 不得互相覆盖',
  )
}

export function testPageBindingsConflictWithGlobalButNotOtherPages(): void {
  const tab = { key: 'tab' }
  const conflicts = findBindingConflicts('trade.toggleProperties', tab, {
    'list.focusNext': tab,
    'reviewSession.skip': tab,
    'global.newTrade': tab,
    'nav.list': tab,
  })
  assert(conflicts.some((item) => item.id === 'global.newTrade'), '详情与全局同时生效，应提示冲突')
  assert(conflicts.some((item) => item.id === 'nav.list'), '详情与全局导航同时生效，应提示冲突')
  assert(!conflicts.some((item) => item.id === 'list.focusNext' || item.id === 'reviewSession.skip'), '互斥页面的绑定不得相互覆盖')
}

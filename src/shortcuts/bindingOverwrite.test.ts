import { buildBindingOverwritePatch, findBindingConflicts } from '@/shortcuts/engine'
import { SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { resolveBinding } from '@/store/shortcutStore'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
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
  assert(result.clearedLabels.includes(other!.label), '应记录被覆盖动作名称')

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

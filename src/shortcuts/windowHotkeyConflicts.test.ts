import {
  disableWindowHotkeyConflicts,
  findWindowHotkeyConflicts,
} from '@/shortcuts/windowHotkeyConflicts'
import { bindingKey } from '@/shortcuts/chords'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testSystemHotkeyConflictsAcrossAllShortcutScopes(): void {
  const conflicts = findWindowHotkeyConflicts({ mod: true, key: 'k' }, {})

  assert(
    conflicts.some((item) => item.id === 'global.commandPaletteMod'),
    '系统键必须跨 scope 冲突',
  )
}

export function testDisablingWindowHotkeyConflictsKeepsOtherBindings(): void {
  const result = disableWindowHotkeyConflicts(
    { key: 'f' },
    { 'global.newTrade': { key: 'n' } },
  )

  assert(result.bindings['list.toggleFilters'] === null, '系统键冲突的普通键必须被禁用')
  assert(bindingKey(result.bindings['global.newTrade']!) === 'n', '无冲突的普通键必须保持不变')
  assert(result.clearedLabels.includes('打开或关闭筛选器'), '应返回被禁用动作的名称')
}

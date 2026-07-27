import {
  DEFAULT_WINDOW_HOTKEY,
  normalizeWindowHotkeyBinding,
  toElectronAccelerator,
} from '@/lib/windowHotkeyBinding'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testWindowHotkeyAcceptsFunctionKeysAndModifiedKeys(): void {
  assert(normalizeWindowHotkeyBinding({ key: 'F10' })?.key === 'f10', 'F10 应规范化')
  assert(
    toElectronAccelerator({ mod: true, alt: true, shift: true, key: 'x' }) ===
      'CommandOrControl+Alt+Shift+X',
    '组合键应转换为 Electron Accelerator',
  )
  assert(DEFAULT_WINDOW_HOTKEY.key === 'f2', '默认值应为 F2')
}

export function testWindowHotkeyRejectsUnsafeBareAndSequenceKeys(): void {
  for (const input of [
    { key: 'a' },
    { key: '7' },
    { key: 'f11' },
    { mod: true, key: '' },
    [{ key: 'f2' }],
    { key: 'f2', unexpected: true },
  ]) {
    assert(normalizeWindowHotkeyBinding(input) === null, `应拒绝 ${JSON.stringify(input)}`)
  }
}

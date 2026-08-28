import { readFileSync } from 'node:fs'
import path from 'node:path'

export function testMenuUsesActionSemanticsWhenNoSelectionValueIsProvided() {
  const source = readFileSync(path.resolve('src/components/Menu.tsx'), 'utf8')

  if (!source.includes("role={isSelectionMenu ? 'menuitemradio' : 'menuitem'}")) {
    throw new Error('Menu actions must not be announced as radio items')
  }
  if (!source.includes('aria-checked={isSelectionMenu ? option.value === value : undefined}')) {
    throw new Error('Only selection menus may expose aria-checked')
  }
}

export function testMenuRendersPopupThroughPortal() {
  const source = readFileSync(path.resolve('src/components/Menu.tsx'), 'utf8')
  const css = readFileSync(path.resolve('src/components/Menu.css'), 'utf8')

  if (!source.includes("from 'react-dom'") || !source.includes('createPortal(')) {
    throw new Error('Menu popup must render through a portal to escape overflow clipping')
  }
  if (!css.includes('position: fixed')) {
    throw new Error('Menu popup must use fixed positioning when portaled')
  }
  if (!source.includes('data-menu-id={menuId}')) {
    throw new Error('Menu root and popup must share data-menu-id so focus can return to the trigger')
  }
}

export function testMenuMeasuresTriggerBeforeOpeningPopup() {
  const source = readFileSync(path.resolve('src/components/Menu.tsx'), 'utf8')
  const css = readFileSync(path.resolve('src/components/Menu.css'), 'utf8')
  const measure = source.indexOf('updatePosition()')
  const open = source.indexOf('setOpen(true)', measure)

  if (measure < 0 || open < 0 || measure > open) {
    throw new Error('菜单必须先按触发器预定位再挂载弹层，避免从视口左上角闪现')
  }
  if (/scale\(/.test(css)) {
    throw new Error('菜单入场不得缩放文字与边界，避免桌面端出现短暂发虚和跳动')
  }
}

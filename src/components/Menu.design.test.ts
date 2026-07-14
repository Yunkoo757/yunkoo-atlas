import { readFileSync } from 'node:fs'
import path from 'node:path'

export function testMenuUsesActionSemanticsWhenNoSelectionValueIsProvided() {
  const source = readFileSync(path.resolve('src/components/Menu.tsx'), 'utf8')

  if (!source.includes("role={isSelectionMenu ? 'menuitemradio' : 'menuitem'}")) {
    throw new Error('Menu actions must not be announced as radio items')
  }
  if (!source.includes('aria-checked={isSelectionMenu ? o.value === value : undefined}')) {
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
}

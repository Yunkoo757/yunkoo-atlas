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

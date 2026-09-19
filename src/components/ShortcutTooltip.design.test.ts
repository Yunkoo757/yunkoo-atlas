import { readFileSync } from 'node:fs'
import path from 'node:path'

export function testShortcutTooltipOmitsUnsetAndNestedShortcutOnlyChrome(): void {
  const source = readFileSync(path.resolve('src/components/ShortcutTooltip.tsx'), 'utf8')

  if (!source.includes('if (!model.hint) return trigger')) {
    throw new Error('没有真实绑定的快捷键不得弹出 Tooltip')
  }
  if (source.includes('未设置')) {
    throw new Error('快捷键提示不得渲染“未设置”')
  }
  if (source.includes('shortcutOnly ? null')) {
    throw new Error('仅快捷键模式不得再套一层空标签加键帽')
  }
}

import { readFileSync } from 'node:fs'
import path from 'node:path'

export function testVisibleSidebarLabelsDoNotRepeatInShortcutTooltips(): void {
  const source = readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8').replace(/\r\n/g, '\n')

  if (source.includes('strategyShortcutActionId') && source.includes('<ShortcutTooltip')) {
    const strategyTooltip = source.match(
      /<ShortcutTooltip actionId=\{strategyShortcutActionId\}[\s\S]*?<\/ShortcutTooltip>/,
    )
    if (strategyTooltip) {
      throw new Error('侧栏策略名称已经直接可见，不得再用 ShortcutTooltip 重复报名或浮层键帽')
    }
  }
  if (!source.includes('sb-item-shortcut')) {
    throw new Error('侧栏策略快捷键应使用行尾提示，而不是浮层')
  }
  if (!source.includes('getShortcutHintModel')) {
    throw new Error('侧栏策略快捷键必须使用真实绑定，不得写死修饰键')
  }
}

export function testVisibleStrategyCoverageDoesNotRepeatInTooltips(): void {
  const source = readFileSync(path.resolve('src/components/StrategyHeader.tsx'), 'utf8').replace(/\r\n/g, '\n')

  if (source.includes("from '@/components/ui/Tooltip'")) {
    throw new Error('策略指标已经直接显示覆盖笔数，不得再用 Tooltip 重复解释')
  }
  if (source.includes('净盈亏仅') || source.includes('总 R 仅')) {
    throw new Error('策略指标不得保留与可见覆盖笔数重复的提示文案')
  }
}

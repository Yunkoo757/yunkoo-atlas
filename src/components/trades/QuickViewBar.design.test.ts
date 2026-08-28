import { readFileSync } from 'node:fs'
import path from 'node:path'

export function testPinnedQuickViewsDoNotRepeatTheirVisibleNameInTooltip(): void {
  const source = readFileSync(path.resolve('src/components/trades/QuickViewBar.tsx'), 'utf8')
  const pinnedStart = source.indexOf('{pinned.map((view) => (')
  const pinnedEnd = source.indexOf('</button>\n        ))}', pinnedStart)
  if (pinnedStart < 0 || pinnedEnd < 0) {
    throw new Error('找不到固定自定义视图渲染区')
  }
  const pinnedMarkup = source.slice(pinnedStart, pinnedEnd)
  if (pinnedMarkup.includes('<Tooltip')) {
    throw new Error('自定义视图名称已经直接可见，不得再用 Tooltip 重复解释')
  }
}

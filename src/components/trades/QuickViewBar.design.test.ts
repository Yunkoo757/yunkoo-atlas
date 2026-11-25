import { readFileSync } from 'node:fs'
import path from 'node:path'

export function testPinnedQuickViewsDoNotRepeatTheirVisibleNameInTooltip(): void {
  const source = readFileSync(path.resolve('src/components/trades/QuickViewBar.tsx'), 'utf8').replace(/\r\n/g, '\n')
  const tabStart = source.indexOf('{tabItems.map((item, index) => {')
  const tabEnd = source.indexOf('</button>', tabStart)
  if (tabStart < 0 || tabEnd < 0) {
    throw new Error('找不到快捷视图渲染区')
  }
  const tabMarkup = source.slice(tabStart, tabEnd)
  if (tabMarkup.includes('<Tooltip') || !tabMarkup.includes('OverflowTooltip text={item.label}')) {
    throw new Error('只应对实际截断的自定义视图名称补充完整提示')
  }
}

import { renderToStaticMarkup } from 'react-dom/server'
import { getStrategyIcon, STRATEGY_ICON_OPTIONS, type StrategyIconId } from '@/data/strategies'
import { LoadingIndicator } from '@/icons/LoadingIndicator'
import { DisclosureIcon } from '@/icons/StateIcons'
import { StatusIndicator } from '@/icons/StatusIndicator'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testLoadingIndicatorUsesAccessibleProductOwnedMarkup(): void {
  const decorative = renderToStaticMarkup(<LoadingIndicator />)
  const labelled = renderToStaticMarkup(<LoadingIndicator title="加载交易库" />)
  assert(decorative.includes('aria-hidden="true"'), '装饰性加载图标必须对辅助技术隐藏')
  assert(labelled.includes('role="img"'), '带标题的加载图标必须暴露图像角色')
  assert(labelled.includes('aria-label="加载交易库"'), '加载图标必须保留可访问名称')
  assert(labelled.includes('<animateTransform'), '加载图标必须自行提供轻量旋转动画')
}

export function testStatusAndDisclosureIndicatorsUseSemanticLucideGlyphs(): void {
  const completed = renderToStaticMarkup(<StatusIndicator state="completed" />)
  const disclosure = renderToStaticMarkup(
    <DisclosureIcon expanded />,
  )
  assert(completed.includes('lucide-circle-check'), '完成状态必须使用明确的完成语义')
  assert(disclosure.includes('data-icon-motion="section"') && disclosure.includes('data-active="true"'), '折叠箭头必须暴露展开状态并保留节点')
}

export function testStrategyIconPickerAndSavedIconsUseTheSameGlyphs(): void {
  const savedIds: StrategyIconId[] = [
    'trending-up', 'arrow-left-right', 'activity', 'newspaper', 'zap', 'target', 'layers',
    'bar-chart-2', 'flame', 'rocket', 'shield', 'line-chart', 'crosshair', 'gauge',
  ]
  const shapes = new Set<string>()
  for (const id of savedIds) {
    const choice = STRATEGY_ICON_OPTIONS.find(option => option.id === id)
    assert(choice && choice.Icon === getStrategyIcon(id), `策略图标 ${id} 应可选择并恢复`)
    const { Icon } = choice
    const markup = renderToStaticMarkup(<Icon size={16} />)
    shapes.add(markup.slice(markup.indexOf('><') + 1))
  }
  assert(shapes.size === savedIds.length, '每个已保存的策略类型都应有可辨别的形状')
  assert(getStrategyIcon('unknown' as StrategyIconId) === getStrategyIcon('target'), '未知历史字形应该回退到目标图标')
}

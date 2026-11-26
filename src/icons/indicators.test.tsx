import { renderToStaticMarkup } from 'react-dom/server'
import { getStrategyIcon, STRATEGY_ICON_OPTIONS, type StrategyIconId } from '@/data/strategies'
import { SymbolIcon } from '@/components/SymbolIcon'
import { DEFAULT_SYMBOL_CATALOG, SYMBOL_ICON_PRESETS, SYMBOL_ICON_SURFACE_TINT, defaultSymbolPresetId } from '@/lib/symbolIcons'
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
  assert(labelled.includes('loading-indicator-motion') && labelled.includes('loading-indicator-static'), '加载指示需同时支持旋转和减少动效时的静态标记')
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

export function testSymbolPresetsAndJournalUseTheSameVectorMarks(): void {
  assert(SYMBOL_ICON_SURFACE_TINT === 12, '详情和设置的品种色底使用 12% 色彩')
  const svgBody = (markup: string) => markup.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1]
  const marks = new Set<string>()
  for (const symbol of DEFAULT_SYMBOL_CATALOG) {
    const preset = SYMBOL_ICON_PRESETS.find(option => option.id === defaultSymbolPresetId(symbol))
    assert(preset, `${symbol} 应有对应的预设选项`)

    const menu = renderToStaticMarkup(<SymbolIcon symbol="CUSTOM" preset={preset} />)
    const row = renderToStaticMarkup(<SymbolIcon symbol={symbol} quiet />)
    const mark = svgBody(row)
    assert(mark && /<(?:path|polygon|polyline|line|circle|rect)\b/.test(mark) && !mark.includes('<text'),
      `${symbol} 的识别形状应使用独立于字体的矢量几何`)
    assert(mark === svgBody(menu), `${symbol} 的设置预览和交易行应呈现相同字形`)
    assert(row.includes('background:transparent') && menu.includes(preset.background), '列表保留无底字标，设置预设使用对应浅色底板')
    marks.add(mark)
  }
  assert(marks.size === DEFAULT_SYMBOL_CATALOG.length, '五款预设应各有可辨的形状')
}

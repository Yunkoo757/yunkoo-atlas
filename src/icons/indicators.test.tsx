import { renderToStaticMarkup } from 'react-dom/server'
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

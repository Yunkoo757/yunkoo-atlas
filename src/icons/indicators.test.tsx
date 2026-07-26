import { renderToStaticMarkup } from 'react-dom/server'
import { LoadingIndicator } from '@/icons/LoadingIndicator'
import { ProgressIndicator } from '@/icons/ProgressIndicator'
import { DisclosureChevron, StatusIndicator } from '@/icons/StatusIndicator'

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

export function testProgressIndicatorClampsProgress(): void {
  const below = renderToStaticMarkup(<ProgressIndicator progress={-2} />)
  const above = renderToStaticMarkup(<ProgressIndicator progress={2} />)
  assert(!below.includes('stroke-dashoffset="-'), '低于零的进度不得产生负偏移')
  assert(above.includes('stroke-dashoffset="0"'), '超过一的进度必须钳制为完整圆环')
}

export function testStatusAndDisclosureIndicatorsUseSemanticLucideGlyphs(): void {
  const completed = renderToStaticMarkup(<StatusIndicator state="completed" />)
  const disclosure = renderToStaticMarkup(
    <DisclosureChevron style={{ transform: 'rotate(90deg)' }} />,
  )
  assert(completed.includes('lucide-circle-check'), '完成状态必须使用明确的完成语义')
  assert(disclosure.includes('rotate(90deg)'), '折叠箭头必须接受调用方的展开旋转')
}

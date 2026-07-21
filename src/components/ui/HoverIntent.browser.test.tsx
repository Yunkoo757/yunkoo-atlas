import { createRoot } from 'react-dom/client'
import { HoverPreview } from '@/components/HoverPreview'
import { Tooltip } from '@/components/ui/Tooltip'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __hoverIntentTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function Harness() {
  return (
    <div style={{ display: 'flex', gap: 24, padding: 80 }}>
      <Tooltip asChild content="普通提示" label="普通提示">
        <button id="tooltip-trigger" type="button">普通提示触发器</button>
      </Tooltip>
      <HoverPreview content={<div>策略统计</div>}>
        <button id="preview-trigger" type="button">策略统计触发器</button>
      </HoverPreview>
    </div>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  root.render(<Harness />)

  try {
    await wait(32)
    const tooltipTrigger = document.getElementById('tooltip-trigger')
    const previewTrigger = document.getElementById('preview-trigger')
    assert(tooltipTrigger && previewTrigger, '浮层触发器没有渲染')

    tooltipTrigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await wait(400)
    assert(!document.querySelector('.ui-tooltip'), '短暂掠过不应立即打开 Tooltip')
    await wait(300)
    assert(document.querySelector('.ui-tooltip'), '稳定停留后 Tooltip 应打开')
    tooltipTrigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    await wait(32)

    previewTrigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await wait(350)
    assert(!document.querySelector('.hover-preview-pop'), '短暂掠过不应立即打开统计预览')
    await wait(190)
    assert(document.querySelector('.hover-preview-pop'), '稳定停留后统计预览应打开')
    previewTrigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    await wait(100)

    tooltipTrigger.focus()
    await wait(32)
    assert(document.querySelector('.ui-tooltip'), '键盘聚焦应立即提供 Tooltip')
  } finally {
    root.unmount()
  }
}

window.__hoverIntentTest = run()

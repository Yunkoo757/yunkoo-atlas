import { createRoot } from 'react-dom/client'
import { Tooltip } from '@/components/ui/Tooltip'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __tooltipEdgeLayoutTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function Harness() {
  return (
    <div style={{ position: 'fixed', top: 12, right: 12 }}>
      <Tooltip asChild delay={0} content="关闭预览 · Esc" label="关闭预览">
        <button id="edge-tooltip-trigger" type="button" aria-label="关闭预览">×</button>
      </Tooltip>
    </div>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  root.render(<Harness />)

  try {
    await waitFor(() => Boolean(document.getElementById('edge-tooltip-trigger')), 'Tooltip 触发器没有渲染')
    const trigger = document.getElementById('edge-tooltip-trigger') as HTMLButtonElement
    trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await waitFor(() => Boolean(document.querySelector('[role="tooltip"]')), 'Tooltip 没有打开')
    await waitForFrame()

    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
    assert(tooltip, 'Tooltip 节点不存在')
    const rect = tooltip.getBoundingClientRect()
    assert(rect.width >= 80, `贴近右边缘时 Tooltip 被压缩：${rect.width}px`)
    assert(rect.height <= 44, `短提示不应纵向逐字排列：${rect.height}px`)
    assert(
      rect.left >= 7 && rect.right <= window.innerWidth - 7,
      `Tooltip 必须完整留在视口内：${rect.left}px–${rect.right}px`,
    )
  } finally {
    root.unmount()
  }
}

window.__tooltipEdgeLayoutTest = run()

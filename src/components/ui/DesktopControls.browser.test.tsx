import { createRoot } from 'react-dom/client'
import { Star } from '@/icons/appIcons'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __desktopControlsTest?: Promise<void>
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
    <main>
      <Button size="sm">工具</Button>
      <Button size="md">页面</Button>
      <Button size="lg" busy>完成</Button>
      <IconButton label="收藏" tooltip="收藏" pressed={false}>
        <Star />
      </IconButton>
      <SegmentedControl
        label="视图"
        value="list"
        options={[
          { value: 'list', label: '列表' },
          { value: 'board', label: '看板' },
        ]}
        onChange={() => undefined}
      />
    </main>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  root.render(<Harness />)

  try {
    await waitFor(() => document.querySelectorAll('.ui-btn').length === 3, '按钮没有渲染')
    const buttons = [...document.querySelectorAll<HTMLElement>('.ui-btn')]
    const heights = buttons.map((node) => Math.round(node.getBoundingClientRect().height))
    assert(heights.join(',') === '28,32,36', `按钮高度错误：${heights.join(',')}`)
    assert(buttons[2]?.getAttribute('aria-busy') === 'true', '忙碌状态缺少 aria-busy')
    assert((buttons[2] as HTMLButtonElement).disabled, '忙碌按钮必须禁用')

    const iconButton = document.querySelector<HTMLButtonElement>('.ui-icon-btn')
    assert(iconButton?.getAttribute('aria-label') === '收藏', '图标按钮缺少可访问名称')
    assert(iconButton.getAttribute('aria-pressed') === 'false', '图标按钮缺少 pressed 状态')
    assert(Math.round(iconButton.getBoundingClientRect().height) === 28, '默认图标按钮必须为 28px')

    const group = document.querySelector<HTMLElement>('[role="group"][aria-label="视图"]')
    assert(group, '缺少分段控件 group 语义')
    const segments = [...group.querySelectorAll<HTMLButtonElement>('button')]
    assert(segments.length === 2, '分段控件选项数量错误')
    segments[0]?.focus()
    segments[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    assert(document.activeElement === segments[1], '右方向键没有移动到下一项')
  } finally {
    root.unmount()
  }
}

window.__desktopControlsTest = run()

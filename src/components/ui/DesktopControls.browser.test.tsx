import { createRoot } from 'react-dom/client'
import { useState } from 'react'
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
  const [view, setView] = useState('list')
  const [scope, setScope] = useState('day')
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
        value={view}
        options={[
          { value: 'list', label: '列表' },
          { value: 'board', label: '看板' },
        ]}
        onChange={setView}
      />
      <SegmentedControl label="风险周期" role="radiogroup" value={scope}
        options={[{ value: 'day', label: '每日' }, { value: 'week', label: '每周', disabled: true }, { value: 'month', label: '每月' }]}
        onChange={setScope} />
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

    const iconBefore = getComputedStyle(iconButton).borderColor
    const iconBounds = iconButton.getBoundingClientRect()
    iconButton.focus()
    await waitFor(() => getComputedStyle(iconButton).borderColor !== iconBefore, '图标按钮必须有可见的焦点边界')
    assert(iconButton.matches(':focus-visible'), '图标按钮应进入键盘焦点状态')
    assert(iconButton.getBoundingClientRect().width === iconBounds.width && iconButton.getBoundingClientRect().height === iconBounds.height, '焦点不得改变图标按钮尺寸')

    const group = document.querySelector<HTMLElement>('[role="group"][aria-label="视图"]')
    assert(group, '缺少分段控件 group 语义')
    const segments = [...group.querySelectorAll<HTMLButtonElement>('button')]
    assert(segments.length === 2, '分段控件选项数量错误')
    assert(segments[0]?.getAttribute('aria-pressed') === 'true', 'group 应暴露当前筛选状态')
    assert(!segments[0]?.hasAttribute('aria-selected'), '普通筛选不得使用页签选中语义')
    const selectedBefore = getComputedStyle(segments[0]!).boxShadow
    const selectedBackground = getComputedStyle(segments[0]!).backgroundColor
    segments[0]?.focus()
    await waitFor(() => getComputedStyle(segments[0]!).boxShadow !== selectedBefore, '已选分段项必须能区分键盘焦点')
    assert(getComputedStyle(segments[0]!).backgroundColor === selectedBackground, '聚焦应保留选中底色')
    assert(Math.round(segments[0]!.getBoundingClientRect().height) === 24, '聚焦不得改变分段项尺寸')
    await waitFor(() => getComputedStyle(iconButton).borderColor === iconBefore, '离开焦点应还原图标按钮边界')
    segments[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    assert(document.activeElement === segments[1], '右方向键没有移动到下一项')
    await waitFor(() => segments[1]?.getAttribute('aria-pressed') === 'true', '方向键没有更新筛选状态')
    const radios = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="风险周期"] [role="radio"]')]
    assert(radios.length === 3 && radios[0]?.getAttribute('aria-checked') === 'true', '风险周期应使用单选语义')
    assert(!radios[0]?.hasAttribute('aria-pressed'), '单选不得混用按压语义')
    assert(radios[1]?.disabled, '禁用选项必须保留原生 disabled')
    radios[0]!.focus()
    radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await waitFor(() => radios[2]?.getAttribute('aria-checked') === 'true', '方向键应跳过禁用项并更新单选状态')
    assert(document.activeElement === radios[2], '焦点应到达下一个可用选项')
  } finally {
    root.unmount()
  }
}

window.__desktopControlsTest = run()

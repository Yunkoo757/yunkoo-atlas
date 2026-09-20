import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { SegmentedControl, type SegmentedControlProps } from './SegmentedControl'
import { Tooltip } from './Tooltip'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __segmentedControlTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 3_000
  while (!condition()) {
    assert(performance.now() < deadline, message)
    await frame()
  }
}

function sameRect(first: DOMRect, second: DOMRect): boolean {
  return ['x', 'y', 'width', 'height'].every((key) => (
    Math.abs(first[key as keyof DOMRect] as number - (second[key as keyof DOMRect] as number)) < 0.15
  ))
}

async function run(): Promise<void> {
  const mount = document.getElementById('root')
  assert(mount, '缺少测试挂载节点')
  const root = createRoot(mount)
  let value = 'short'
  let hidden = false
  let scale = 1
  let longLabel = '年度复盘趋势'
  let size: SegmentedControlProps<string>['size'] = 'sm'
  let role: SegmentedControlProps<string>['role'] = 'group'
  const render = () => flushSync(() => root.render(
    <StrictMode>
      <main style={{ display: hidden ? 'none' : 'block', padding: 24, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <SegmentedControl
          label="动效回归"
          value={value}
          size={size}
          role={role}
          onChange={(next) => { value = next; render() }}
          options={[
            { value: 'short', label: '周' },
            { value: 'disabled', label: '停用', disabled: true },
            { value: 'long', label: longLabel, wrap: (button) => (
              <Tooltip key="long" content="年度视图" label="年度视图">{button}</Tooltip>
            ) },
            { value: 'last', label: '月度' },
          ]}
        />
      </main>
    </StrictMode>,
  ))
  const select = (next: string) => { value = next; render() }

  try {
    render()
    const group = document.querySelector<HTMLDivElement>('.ui-segmented')!
    const indicator = group.querySelector<HTMLSpanElement>('.ui-segmented-indicator')!
    const buttons = [...group.querySelectorAll<HTMLButtonElement>('button')]
    const selectedButton = () => buttons.find((button) => button.dataset.value === value)!
    const aligned = () => sameRect(indicator.getBoundingClientRect(), selectedButton().getBoundingClientRect())
    const settle = () => waitFor(() => aligned() && indicator.getAnimations().length === 0, '底板应准确对齐当前选中项并完成过渡')
    const baseline = buttons.map((button) => button.getBoundingClientRect())
    const baselineGroup = group.getBoundingClientRect()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const assertLayout = () => {
      assert(sameRect(group.getBoundingClientRect(), baselineGroup), '切换不得改变控件整体尺寸或位置')
      buttons.forEach((button, index) => assert(sameRect(button.getBoundingClientRect(), baseline[index]!), '切换不得移动或缩放按钮'))
    }

    assert(indicator.getAttribute('aria-hidden') === 'true', '装饰底板必须对辅助技术隐藏')
    assert(getComputedStyle(indicator).pointerEvents === 'none', '底板不得拦截点击')
    assert(aligned() && indicator.getAnimations().length === 0, '首次挂载应静态对齐，不能从零位滑入')
    assert(Math.round(baselineGroup.height) === 28, '小号分段控件应保留 28px 高度')
    assert(buttons[0]!.getAttribute('aria-pressed') === 'true', '普通切换应保留按压语义')
    await frame()
    await frame()

    buttons[1]!.click()
    assert(String(value) === 'short', '禁用按钮不得改变值')
    buttons[0]!.focus()
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    assert(String(value) === 'long' && document.activeElement === buttons[2], '方向键应跳过禁用项并聚焦下一项')
    assert(buttons[2]!.tabIndex === 0 && buttons[0]!.tabIndex === -1, '键盘切换应保留 roving tabindex')
    assert(buttons[2]!.matches(':focus-visible'), '键盘切换应保留可见焦点')
    assert(getComputedStyle(buttons[2]!).boxShadow !== 'none', '选中状态不能遮掉焦点内描边')
    assertLayout()

    if (reduced) {
      assert(aligned() && indicator.getAnimations().length === 0, '减少动态效果时应立即对齐且无动画')
      assert(getComputedStyle(indicator).transitionProperty === 'none', '减少动态效果应显式移除过渡')
    } else {
      const animations = indicator.getAnimations()
      assert(animations.length > 0, '正常模式切换应启动底板过渡')
      const duration = parseFloat(getComputedStyle(group).getPropertyValue('--motion-dialog-in'))
      assert(animations.every((animation) => animation.effect?.getTiming().duration === duration), '底板应消费既有短动效时长')
      animations.forEach((animation) => { animation.pause(); animation.currentTime = duration / 3 })
      const moving = indicator.getBoundingClientRect()
      assert(moving.left > baseline[0]!.left && moving.left < baseline[2]!.left, '底板中途位置应连接前后选项')
      assert(moving.width > baseline[0]!.width && moving.width < baseline[2]!.width, '不同宽度标签之间应连续变化')
      select('last')
      assert(sameRect(moving, indicator.getBoundingClientRect()), '快速切换必须从当前可见位置继续，不能跳回起点')
      assertLayout()
    }
    await settle()

    for (const next of ['short', 'last', 'long', 'short']) {
      select(next)
      assertLayout()
    }
    await settle()
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    assert(String(value) === 'last' && document.activeElement === buttons[3], 'End 应保留末项导航')
    await settle()
    buttons[3]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    assert(String(value) === 'short' && document.activeElement === buttons[0], 'Home 应保留首项导航')
    await settle()

    select('long')
    await settle()
    longLabel = '包含较长中文标签的年度复盘趋势'
    render()
    assert(aligned() && indicator.getAnimations().length === 0, '标签变化应重新测量并静态对齐')
    group.style.width = '420px'
    group.style.justifyContent = 'space-between'
    await settle()
    assert(indicator.getAnimations().length === 0, '容器布局变化不应触发选择动效')
    // A font metric change exercises the same ResizeObserver path as late font loading.
    buttons[2]!.style.fontSize = '20px'
    await settle()
    assert(indicator.getAnimations().length === 0, '字体尺寸变化应静态重新对齐')
    buttons[2]!.style.removeProperty('font-size')
    group.style.removeProperty('width')
    group.style.removeProperty('justify-content')
    await settle()

    hidden = true
    render()
    select('last')
    assert(!group.dataset.indicatorReady, '隐藏容器不能保留无效测量结果')
    hidden = false
    render()
    assert(aligned() && indicator.getAnimations().length === 0, '重新显示应立即对齐外部更新值')
    // Also cover visibility changes outside React, as used by mounted panels.
    group.style.display = 'none'
    await waitFor(() => !group.dataset.indicatorReady, '隐藏时观察器应清除测量状态')
    group.style.removeProperty('display')
    await settle()
    assert(indicator.getAnimations().length === 0, 'CSS 隐藏后显示不得出现跨控件飞入')

    scale = 0.94
    size = 'md'
    role = 'tablist'
    render()
    assert(aligned(), '缩放中的浮层内应按本地坐标准确对齐')
    assert(buttons[3]!.getAttribute('aria-selected') === 'true' && !buttons[3]!.hasAttribute('aria-pressed'), '页签应保留独立语义')
    scale = 1
    size = 'lg'
    role = 'radiogroup'
    render()
    assert(aligned() && Math.round(group.getBoundingClientRect().height) === 36, '大号控件应保留尺寸并正确对齐')
    assert(buttons[3]!.getAttribute('aria-checked') === 'true', '单选组应保留 checked 语义')
    select('disabled')
    await settle()
    assert(buttons[1]!.disabled && buttons[1]!.getAttribute('aria-checked') === 'true', '外部选中禁用值仍应正确显示其状态')
    select('missing')
    assert(!group.dataset.indicatorReady, '无有效选中项时不得遗留底板')
    select('short')
    assert(aligned(), '恢复有效选中项应静态对齐')
  } finally {
    root.unmount()
  }
}

window.__segmentedControlTest = run()

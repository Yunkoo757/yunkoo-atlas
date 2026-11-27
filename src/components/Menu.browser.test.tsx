import { nextFrame as frame, waitFor } from '../test/browserTiming'
import { createRoot } from 'react-dom/client'
import { Menu } from '@/components/Menu'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __menuBrowserTest: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function pressKey(key: string): void {
  const target = document.activeElement
  assert(target instanceof HTMLElement, `按下 ${key} 前缺少活动元素`)
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  }))
}

function OpaqueTrigger() {
  return (
    <button type="button" aria-label="共享菜单触发器">
      打开菜单
    </button>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  let selected = ''

  try {
    root.render(
      <Menu
        trigger={<OpaqueTrigger />}
        options={[
          { value: 'first', label: '第一项' },
          { type: 'separator' },
          { value: 'second', label: '第二项' },
          { value: 'third', label: '第三项', danger: true },
        ]}
        onSelect={(value) => {
          selected = value
        }}
      />,
    )

    await waitFor(
      () => document.querySelector('[aria-label="共享菜单触发器"]') !== null,
      '共享菜单触发器未渲染',
    )
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="共享菜单触发器"]')
    assert(trigger, '找不到共享菜单真实触发控件')
    assert(trigger.getAttribute('aria-haspopup') === 'menu', '真实触发控件缺少 aria-haspopup="menu"')
    assert(trigger.getAttribute('aria-expanded') === 'false', '关闭态真实触发控件缺少 aria-expanded="false"')
    const controls = trigger.getAttribute('aria-controls')
    assert(controls, '真实触发控件缺少 aria-controls')

    trigger.click()
    await waitFor(() => document.getElementById(controls) !== null, 'aria-controls 未指向实际菜单')
    const menu = document.getElementById(controls)
    assert(menu?.getAttribute('role') === 'menu', 'aria-controls 目标不是 menu')
    assert(trigger.getAttribute('aria-expanded') === 'true', '打开态真实触发控件缺少 aria-expanded="true"')
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    assert(items.length === 3, '共享菜单必须渲染三个真实菜单项')
    assert(menu.classList.contains('ui-popover-menu'), '普通菜单应消费统一菜单浮层材质')
    const itemHeight = getComputedStyle(document.documentElement).getPropertyValue('--menu-item-height').trim()
    assert(items.every(item => getComputedStyle(item).height === itemHeight), '普通菜单项应遵循统一行高')
    const separator = document.querySelector<HTMLElement>('[role="separator"]')
    assert(separator && separator.tagName !== 'BUTTON', '菜单分隔符必须存在且不可成为按钮')
    assert(items[2].classList.contains('menu-item-danger'), '危险动作必须显示统一的危险语义样式')
    assert(document.activeElement === items[0], '共享菜单打开后首项必须自然获得焦点')

    pressKey('ArrowDown')
    assert(document.activeElement === items[1], 'ArrowDown 必须移动到下一项')
    pressKey('ArrowDown')
    assert(document.activeElement === items[2], '第二次 ArrowDown 必须移动到末项')
    pressKey('ArrowDown')
    assert(document.activeElement === items[0], 'ArrowDown 必须从末项循环到首项')
    pressKey('ArrowUp')
    assert(document.activeElement === items[2], 'ArrowUp 必须从首项循环到末项')
    pressKey('Home')
    assert(document.activeElement === items[0], 'Home 必须移动到首项')
    pressKey('End')
    assert(document.activeElement === items[2], 'End 必须移动到末项')

    pressKey('Escape')
    await waitFor(() => document.getElementById(controls) === null, 'Escape 未关闭共享菜单')
    assert(document.activeElement === trigger, 'Escape 必须把焦点还给真实触发控件')
    assert(trigger.getAttribute('aria-expanded') === 'false', 'Escape 后 aria-expanded 未恢复关闭态')

    trigger.click()
    await waitFor(() => document.getElementById(controls) !== null, '共享菜单未能重新打开')
    const reopenedItems = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    assert(document.activeElement === reopenedItems[0], '重新打开共享菜单后首项必须自然获得焦点')
    reopenedItems[0].click()
    await waitFor(() => document.getElementById(controls) === null, '选择菜单项后共享菜单未关闭')
    assert(selected === 'first', '共享菜单选择行为发生回归')

    const options = Array.from({ length: 50 }, (_, i) => ({ value: String(i), label: '模板 ' + (i + 1) }))
    root.render(
      <div style={{ position: 'fixed', right: 8, bottom: 60 }}>
        <Menu trigger={<OpaqueTrigger />} options={options} value="48" onSelect={(value) => { selected = value }} />
      </div>,
    )
    await frame()
    const longTrigger = document.querySelector<HTMLButtonElement>('[aria-label="共享菜单触发器"]')!
    longTrigger.click()
    await waitFor(() => Boolean(document.querySelector('[role="menuitemradio"][aria-checked="true"]')), '长菜单未打开')
    await frame()
    const longMenu = document.querySelector<HTMLElement>('[role="menu"]')!
    await Promise.all(longMenu.getAnimations().map(animation => animation.finished))
    const bounds = longMenu.getBoundingClientRect()
    assert(bounds.top >= 7 && bounds.bottom <= innerHeight - 7, '未限宽菜单也必须完整留在视口')
    assert(bounds.bottom <= longTrigger.getBoundingClientRect().top, '下方不足时长菜单应向上展开')
    assert(longMenu.scrollHeight > longMenu.clientHeight && getComputedStyle(longMenu).overflowY === 'auto', '长菜单必须可滚动')
    const radioItems = [...longMenu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    const focusedVisible = (item: HTMLElement) => {
      const rect = item.getBoundingClientRect()
      return document.activeElement === item && rect.top >= bounds.top && rect.bottom <= bounds.bottom
    }
    assert(focusedVisible(radioItems[48]), '打开选择菜单应聚焦并滚动到当前选项')
    pressKey('Home')
    assert(focusedVisible(radioItems[0]), 'Home 应将长菜单首项滚入视口')
    pressKey('End')
    assert(focusedVisible(radioItems.at(-1)!), 'End 应将长菜单末项滚入视口')
    await frame()
    assert(longMenu.querySelector('[data-keyboard-item]') === radioItems.at(-1), '方向键位置应可辨认')
    longMenu.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    await frame()
    assert(!longMenu.querySelector('[data-keyboard-item]'), '移动指针应回到悬停反馈')
    pressKey('ArrowDown')
    assert(focusedVisible(radioItems[0]), '方向键循环时应滚回首项')
    pressKey('End')
    radioItems.at(-1)!.click()
    await waitFor(() => !document.querySelector('[role="menu"]'), '长菜单选择末项后未关闭')
    assert(String(selected) === '49', '末项无法正常选择')
  } finally {
    root.unmount()
  }
}

window.__menuBrowserTest = run()

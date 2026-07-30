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

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
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
          { value: 'second', label: '第二项' },
          { value: 'third', label: '第三项' },
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
  } finally {
    root.unmount()
  }
}

window.__menuBrowserTest = run()

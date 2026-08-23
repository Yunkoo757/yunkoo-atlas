import { createRoot } from 'react-dom/client'
import { AppFrame } from '@/components/ui/AppFrame'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __appFrameKeyboardSafetyTest?: Promise<void>
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function run() {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)

  try {
    useStore.setState((state) => ({
      display: { ...state.display, showKeyboardFocusRings: false },
    }))
    root.render(
      <AppFrame sidebar={<div />}>
        <button type="button" data-keyboard-target>键盘目标</button>
      </AppFrame>,
    )
    await frame()
    await frame()

    const target = document.querySelector<HTMLButtonElement>('[data-keyboard-target]')
    assert(target, '缺少键盘焦点目标')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    target.focus()
    for (let attempt = 0; attempt < 8 && document.documentElement.dataset.keyboardNavigation !== 'true'; attempt += 1) {
      await frame()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      target.focus()
    }
    assert(document.documentElement.dataset.keyboardNavigation === 'true', 'Tab 必须进入键盘导航状态')
    assert(getComputedStyle(target).outlineStyle !== 'none', '关闭增强高光时，真实键盘导航仍须显示基础定位线')

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    target.blur()
    target.focus()
    assert(document.documentElement.dataset.keyboardNavigation === undefined, '指针操作必须退出键盘导航状态')
    assert(getComputedStyle(target).outlineStyle === 'none', '关闭增强高光时，指针/程序焦点不得显示额外轮廓')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__appFrameKeyboardSafetyTest = run()

import { createRoot } from 'react-dom/client'
import { AppFrame } from '@/components/ui/AppFrame'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'
import { DisplaySettingsPanel } from './DisplaySettingsPanel'

declare global {
  interface Window {
    __displayFocusPreferenceTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(
  condition: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (condition()) return
    await nextFrame()
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')

  const originalDisplay = useStore.getState().display
  useStore.setState({
    display: { ...originalDisplay, showKeyboardFocusRings: false },
  })
  const root = createRoot(rootElement)

  try {
    root.render(
      <AppFrame sidebar={<div>侧栏</div>}>
        <DisplaySettingsPanel />
        <label>
          文本输入
          <input type="text" defaultValue="正在编辑" />
        </label>
      </AppFrame>,
    )
    await nextFrame()
    await nextFrame()

    const switchControl = [...document.querySelectorAll<HTMLElement>('[role="switch"]')]
      .find((node) => node.textContent?.includes('显示键盘焦点高光'))
    assert(switchControl?.getAttribute('aria-checked') === 'false', '默认必须关闭')

    const rootFrame = document.querySelector<HTMLElement>('.ui-app-frame')
    const main = document.querySelector<HTMLElement>('.ui-main-frame')
    assert(rootFrame, '应用根节点未渲染')
    assert(main, '主工作区未渲染')
    assert(rootFrame.dataset.keyboardFocusRings === 'off', '根节点必须同步关闭状态')

    main.focus()
    assert(document.activeElement === main, '关闭高光不得阻止主工作区获得焦点')
    assert(getComputedStyle(main).outlineStyle === 'none', '关闭时不得显示工作区焦点轮廓')

    const input = document.querySelector<HTMLInputElement>('input[type="text"]')
    assert(input, '文本输入框未渲染')
    input.focus()
    const inputStyle = getComputedStyle(input)
    assert(document.activeElement === input, '关闭高光不得阻止文本输入框获得焦点')
    assert(
      inputStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && inputStyle.borderStyle !== 'none',
      '关闭时仍须保留输入组件自己的 border/background 编辑反馈',
    )

    switchControl.click()
    await waitFor(
      () => useStore.getState().display.showKeyboardFocusRings,
      '开关未写入 store',
    )
    await waitFor(
      () => rootFrame.dataset.keyboardFocusRings === 'on',
      '根节点必须同步开启状态',
    )

    main.blur()
    main.focus()
    const enabledStyle = getComputedStyle(main)
    assert(document.activeElement === main, '开启高光不得改变真实焦点移动')
    assert(
      enabledStyle.outlineStyle !== 'none' && parseFloat(enabledStyle.outlineWidth) >= 2,
      '开启后必须恢复清晰的焦点轮廓',
    )
  } finally {
    root.unmount()
    useStore.setState({ display: originalDisplay })
  }
}

window.__displayFocusPreferenceTest = run()

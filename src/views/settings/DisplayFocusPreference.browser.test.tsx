import { createRoot } from 'react-dom/client'
import { Menu } from '@/components/Menu'
import { AppFrame } from '@/components/ui/AppFrame'
import { FieldTrigger } from '@/components/ui/FieldTrigger'
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

async function verifyDocumentFocusRingOwnershipAcrossUnmountOrders(): Promise<void> {
  const documentRoot = document.documentElement
  const initialValue = documentRoot.dataset.keyboardFocusRings
  const originalDisplay = useStore.getState().display
  useStore.setState({
    display: { ...originalDisplay, showKeyboardFocusRings: false },
  })

  try {
    for (const firstToUnmount of ['earlier', 'later'] as const) {
      documentRoot.dataset.keyboardFocusRings = 'initial-owner-sentinel'
      const earlierContainer = document.createElement('div')
      const laterContainer = document.createElement('div')
      document.body.append(earlierContainer, laterContainer)
      const earlierRoot = createRoot(earlierContainer)
      const laterRoot = createRoot(laterContainer)
      let earlierMounted = true
      let laterMounted = true

      try {
        earlierRoot.render(<AppFrame sidebar={<div>早挂载侧栏</div>}>早挂载内容</AppFrame>)
        await nextFrame()
        laterRoot.render(<AppFrame sidebar={<div>晚挂载侧栏</div>}>晚挂载内容</AppFrame>)
        await nextFrame()
        await nextFrame()
        assert(
          documentRoot.dataset.keyboardFocusRings === 'off',
          `${firstToUnmount} 顺序挂载后必须由存活 AppFrame 控制文档属性`,
        )

        if (firstToUnmount === 'earlier') {
          earlierRoot.unmount()
          earlierMounted = false
        } else {
          laterRoot.unmount()
          laterMounted = false
        }
        await nextFrame()
        assert(
          documentRoot.dataset.keyboardFocusRings === 'off',
          `先卸载 ${firstToUnmount} 实例后，存活 AppFrame 必须继续控制文档属性`,
        )

        if (earlierMounted) {
          earlierRoot.unmount()
          earlierMounted = false
        }
        if (laterMounted) {
          laterRoot.unmount()
          laterMounted = false
        }
        await nextFrame()
        assert(
          documentRoot.getAttribute('data-keyboard-focus-rings') === 'initial-owner-sentinel',
          `按 ${firstToUnmount} 顺序卸载最后实例后必须恢复初始文档属性`,
        )
      } finally {
        if (earlierMounted) earlierRoot.unmount()
        if (laterMounted) laterRoot.unmount()
        earlierContainer.remove()
        laterContainer.remove()
      }
    }
  } finally {
    useStore.setState({ display: originalDisplay })
    if (initialValue === undefined) {
      delete documentRoot.dataset.keyboardFocusRings
    } else {
      documentRoot.dataset.keyboardFocusRings = initialValue
    }
  }
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
        <Menu
          trigger={<button type="button" aria-label="焦点高光测试菜单">打开菜单</button>}
          options={[{ value: 'first', label: '菜单第一项' }]}
          onSelect={() => {}}
        />
        <FieldTrigger aria-label="阴影焦点测试控件">阴影焦点控件</FieldTrigger>
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
    await waitFor(
      () => document.documentElement.dataset.keyboardFocusRings === 'off',
      '文档根必须同步关闭状态以覆盖 portal',
    )

    const restingMainShadow = getComputedStyle(main).boxShadow
    assert(restingMainShadow !== 'none', '主工作区必须保留业务 surface shadow 基线')
    main.focus()
    assert(document.activeElement === main, '关闭高光不得阻止主工作区获得焦点')
    assert(getComputedStyle(main).outlineStyle === 'none', '关闭时不得显示工作区焦点轮廓')
    assert(
      getComputedStyle(main).boxShadow === restingMainShadow,
      '关闭焦点高光不得清除主工作区业务 surface shadow',
    )

    const input = document.querySelector<HTMLInputElement>('input[type="text"]')
    assert(input, '文本输入框未渲染')
    const restingInputStyle = getComputedStyle(input)
    const restingInputBackground = restingInputStyle.backgroundColor
    const restingInputBorder = restingInputStyle.borderColor
    input.focus()
    const inputStyle = getComputedStyle(input)
    assert(document.activeElement === input, '关闭高光不得阻止文本输入框获得焦点')
    assert(
      inputStyle.backgroundColor !== restingInputBackground,
      '关闭时仍须保留输入组件自己的 background 编辑反馈',
    )
    assert(
      inputStyle.borderColor !== restingInputBorder,
      '关闭时仍须保留输入组件自己的 border 编辑反馈',
    )

    const menuTrigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="焦点高光测试菜单"]',
    )
    assert(menuTrigger, '菜单触发器未渲染')
    menuTrigger.click()
    await waitFor(
      () => document.querySelector('[role="menuitem"]') !== null,
      '真实 portal 菜单未打开',
    )
    const disabledMenuItem = document.querySelector<HTMLButtonElement>('[role="menuitem"]')
    assert(disabledMenuItem, '真实 portal 菜单项未渲染')
    assert(!rootFrame.contains(disabledMenuItem), '菜单项必须通过 portal 渲染到 AppFrame 外部')
    assert(document.activeElement === disabledMenuItem, '关闭高光不得阻止菜单首项获得焦点')
    assert(
      getComputedStyle(disabledMenuItem).outlineStyle === 'none',
      '关闭时 portal 菜单项不得显示焦点轮廓',
    )
    disabledMenuItem.click()

    const shadowFocusControl = document.querySelector<HTMLButtonElement>(
      '[aria-label="阴影焦点测试控件"]',
    )
    assert(shadowFocusControl, '阴影焦点测试控件未渲染')
    shadowFocusControl.focus()
    assert(document.activeElement === shadowFocusControl, '关闭高光不得阻止阴影控件获得焦点')
    assert(
      getComputedStyle(shadowFocusControl).boxShadow === 'none',
      '关闭时必须隐藏非输入控件的焦点 ring shadow',
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
    await waitFor(
      () => document.documentElement.dataset.keyboardFocusRings === 'on',
      '文档根必须同步开启状态以覆盖 portal',
    )

    main.blur()
    main.focus()
    const enabledStyle = getComputedStyle(main)
    assert(document.activeElement === main, '开启高光不得改变真实焦点移动')
    assert(
      enabledStyle.outlineStyle !== 'none' && parseFloat(enabledStyle.outlineWidth) >= 2,
      '开启后必须恢复清晰的焦点轮廓',
    )

    shadowFocusControl.focus()
    assert(document.activeElement === shadowFocusControl, '开启高光不得改变阴影控件焦点')
    assert(
      getComputedStyle(shadowFocusControl).boxShadow !== 'none',
      '开启后必须恢复非输入控件的焦点 ring shadow',
    )

    menuTrigger.click()
    await waitFor(
      () => document.querySelector('[role="menuitem"]') !== null,
      '开启后真实 portal 菜单未打开',
    )
    const enabledMenuItem = document.querySelector<HTMLButtonElement>('[role="menuitem"]')
    assert(enabledMenuItem, '开启后真实 portal 菜单项未渲染')
    const enabledMenuStyle = getComputedStyle(enabledMenuItem)
    assert(document.activeElement === enabledMenuItem, '开启高光不得改变菜单首项焦点')
    assert(
      enabledMenuStyle.outlineStyle !== 'none' && parseFloat(enabledMenuStyle.outlineWidth) >= 2,
      '开启后 portal 菜单项必须恢复清晰的焦点轮廓',
    )
  } finally {
    root.unmount()
    useStore.setState({ display: originalDisplay })
  }

  await verifyDocumentFocusRingOwnershipAcrossUnmountOrders()
}

window.__displayFocusPreferenceTest = run()

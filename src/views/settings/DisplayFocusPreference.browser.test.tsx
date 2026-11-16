import { useStore } from '@/store/useStore'
import { createRoot } from 'react-dom/client'
import { AppFrame } from '@/components/ui/AppFrame'
import { DisplaySettingsPanel } from './DisplaySettingsPanel'
import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/components/Sidebar.css'

declare global { interface Window { __displayFocusPreferenceTest?: Promise<void> } }
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function run() {
  const root = createRoot(document.getElementById('root')!)
  const previousDisplay = useStore.getState().display
  try {
    root.render(<AppFrame sidebar={<div className="sb-sortable-row"><button className="sb-item">导航</button></div>}><DisplaySettingsPanel /></AppFrame>)
    await frame(); await frame()
    assert(!document.body.textContent?.includes('显示键盘焦点高光'), '显示设置不得残留焦点高光选项')
    const target = document.querySelector<HTMLButtonElement>('.sb-item')!
    for (const key of ['Tab', 'ArrowDown']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      target.focus(); await frame()
      assert(document.activeElement === target, '不得破坏底层聚焦和键盘操作')
      assert(getComputedStyle(target).outlineStyle === 'none', '导航不得出现外轮廓')
      assert(getComputedStyle(target).boxShadow === 'none', '导航不得出现焦点阴影')
      assert(getComputedStyle(target.parentElement!).boxShadow === 'none', '整行不得出现第二层定位边框')
    }
    assert(!document.documentElement.hasAttribute('data-keyboard-navigation'), '不得继续监听并创建键盘导航状态')
    assert(!document.querySelector('[data-keyboard-focus-rings]'), '不得继续同步已移除偏好')
    const option = (group: string, text: string) => [...document.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)].find(button => button.textContent === text)!
    option('默认排序', '盈亏表现').click(); await frame()
    option('排序方向', '升序').click(); await frame()
    assert(useStore.getState().display.sortBy === 'pnl' && useStore.getState().display.sortDirection === 'asc', '字段和方向必须独立设置')
    option('默认排序', '盈亏表现').click(); await frame()
    assert(useStore.getState().display.sortDirection === 'asc', '重复选择同一字段不得暗中反转方向')
    option('排序方向', '降序').click(); await frame()
    assert(useStore.getState().display.sortDirection === 'desc', '降序动作必须显式生效')
  } finally { root.unmount(); useStore.setState({ display: previousDisplay }) }
}
window.__displayFocusPreferenceTest = run()

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
  } finally { root.unmount() }
}
window.__displayFocusPreferenceTest = run()

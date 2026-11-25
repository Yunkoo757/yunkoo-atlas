import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { StatusIcon } from './StatusIcon'
import '@/styles/tokens.css'
import '@/styles/global.css'
import './trades/TradeList.css'

declare global { interface Window { __statusIconLuminanceTest?: Promise<void> } }

function Harness() {
  const [status, setStatus] = useState<'win' | 'loss'>('win')
  return <><button id="change-status" onClick={() => setStatus((value) => value === 'win' ? 'loss' : 'win')}>切换状态</button>
    <div className="trade-row"><StatusIcon status={status} /><button id="row-focus">行内操作</button></div></>
}

window.__statusIconLuminanceTest = (async () => {
  const root = createRoot(document.getElementById('root')!)
  const wait = () => new Promise((resolve) => setTimeout(resolve, 250))
  const opacity = () => Number(getComputedStyle(document.querySelector('.status-icon')!).opacity)
  const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
  root.render(<StrictMode><Harness /></StrictMode>)
  try {
    await wait()
    const glyph = document.querySelector<SVGSVGElement>('[data-icon-motion="status"]')!
    const restOpacity = Number(getComputedStyle(glyph).getPropertyValue('--list-status-opacity-rest'))
    const ring = glyph.querySelector('.status-ring')!
    const mark = glyph.querySelector('.status-result')!
    const toggle = document.querySelector<HTMLButtonElement>('#change-status')!
    check(glyph.getAnimations({ subtree: true }).length === 0, '首次挂载应处于静止终态')
    check(opacity() === restOpacity, '静态亮度必须使用列表角色')
    const originalPath = getComputedStyle(mark).d
    const originalWidth = glyph.getBoundingClientRect().width
    toggle.click()
    await Promise.resolve()
    const morph = mark.getAnimations().find(animation =>
      animation instanceof CSSTransition && animation.transitionProperty === 'd')
    check(Boolean(morph), '盈亏变化应在原笔画上执行路径过渡')
    morph!.pause()
    morph!.currentTime = 30
    const intermediate = getComputedStyle(mark).d
    check(intermediate !== originalPath && glyph.dataset.status === 'loss', '业务状态应即时生效，笔画应经过中间态')
    toggle.click()
    await Promise.resolve()
    check(getComputedStyle(mark).d === intermediate, '反向切换应从当前路径起步')
    await wait()
    check(glyph.isConnected && ring.isConnected && mark.isConnected, '快速切换应保留原图标和圆环')
    check(getComputedStyle(mark).d === originalPath && glyph.dataset.status === 'win', '反向切换应回到原始轮廓')
    check(glyph.getBoundingClientRect().width === originalWidth && opacity() === restOpacity, '反向切换应维持图标宽度与列表亮度')
    document.querySelector<HTMLButtonElement>('#row-focus')!.focus()
    await wait()
    check(document.activeElement?.id === 'row-focus' && opacity() === restOpacity, '键盘进入行内操作时状态图标应沿用静态亮度')
    document.querySelector<HTMLButtonElement>('#row-focus')!.blur()
    await wait()
    check(opacity() === restOpacity, '离开行内聚焦应恢复静态亮度')
  } finally { root.unmount() }
})()

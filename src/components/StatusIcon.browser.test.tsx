import { StrictMode, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ConvictionIcon, StatusIcon } from './StatusIcon'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import type { TradeStatus } from '@/data/trades'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import '@/styles/tokens.css'
import '@/styles/global.css'
import './trades/TradeList.css'

declare global { interface Window { __statusIconLuminanceTest?: Promise<void> } }

const statusMark: Record<TradeStatus, string> = {
  planned: '.status-plan',
  open: '.status-progress',
  missed: '.status-skip',
  win: '.status-result',
  breakeven: '.status-result',
  loss: '.status-result',
}

function Harness() {
  const [status, setStatus] = useState<'win' | 'loss'>('win')
  return <><button id="change-status" onClick={() => setStatus((value) => value === 'win' ? 'loss' : 'win')}>切换状态</button>
    <div className="trade-row"><StatusIcon status={status} /><button id="row-focus">行内操作</button></div>
    {[ICON_SM, ICON_MD].map(size => <div key={size} data-option-size={size}>
      {STATUS_ORDER.map(value => <StatusIcon key={value} status={value} size={size} />)}
    </div>)}
    <div id="conviction-options">{(['low', 'medium', 'high', 'urgent'] as const).map(value =>
      <ConvictionIcon key={value} conviction={value} />)}</div></>
}

window.__statusIconLuminanceTest = (async () => {
  const root = createRoot(document.getElementById('root')!)
  const wait = () => new Promise((resolve) => setTimeout(resolve, 250))
  const opacity = () => Number(getComputedStyle(document.querySelector('.status-icon')!).opacity)
  const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
  flushSync(() => root.render(<StrictMode><Harness /></StrictMode>))
  try {
    const glyph = document.querySelector<SVGSVGElement>('[data-icon-motion="status"]')!
    const restOpacity = Number(getComputedStyle(glyph).getPropertyValue('--list-status-opacity-rest'))
    const ring = glyph.querySelector('.status-ring')!
    const mark = glyph.querySelector('.status-result')!
    const toggle = document.querySelector<HTMLButtonElement>('#change-status')!
    check(glyph.getAnimations({ subtree: true }).length === 0, '首次挂载应处于静止终态')
    check(opacity() === restOpacity, '静态亮度必须使用列表角色')
    for (const group of document.querySelectorAll<HTMLElement>('[data-option-size]')) {
      const size = Number(group.dataset.optionSize)
      const silhouettes = new Set<string>()
      for (const icon of group.querySelectorAll<SVGSVGElement>('svg')) {
        const status = icon.dataset.status as TradeStatus
        const closed = status === 'win' || status === 'breakeven' || status === 'loss'
        const outline = icon.querySelector('.status-ring')!
        const disc = icon.querySelector('.status-disc')!
        const result = icon.querySelector<SVGPathElement>('.status-result')!
        const discOpacity = Number(getComputedStyle(disc).opacity)
        check(icon.getBoundingClientRect().width === size, `${status} 应按 ${size}px 显示`)
        check((Number(getComputedStyle(outline).opacity) > 0) === (status === 'open'), '完整外圈只用于持仓')
        check(closed ? discOpacity > 0 && discOpacity < 0.5 : discOpacity === 0, '只有结算状态使用浅底')
        const marker = icon.querySelector(statusMark[status])!
        check(Number(getComputedStyle(marker).opacity) > 0, `${status} 应呈现自己的识别记号`)
        if (status === 'win' || status === 'breakeven') {
          // Measure the identifying mark in screen pixels, excluding its surrounding disc.
          check(result.getBoundingClientRect().width >= size / 2, `${size}px 的 ${status} 内笔画应至少占半幅`)
        }
        const strokes = Array.from(icon.children).filter(child => Number(getComputedStyle(child).opacity) > 0)
        const signature = strokes.map(stroke => {
          const style = getComputedStyle(stroke)
          const box = stroke.getBoundingClientRect()
          return [stroke.tagName, style.d, style.strokeDasharray, box.width, box.height].join(' ')
        }).join('|')
        silhouettes.add(signature)
      }
      check(silhouettes.size === STATUS_ORDER.length, `${size}px 下六种状态去除颜色后仍应可辨`)
    }
    const levels = Array.from(document.querySelectorAll('#conviction-options svg'), icon =>
      Array.from(icon.children).filter(bar => getComputedStyle(bar).fill === getComputedStyle(icon.firstElementChild!).fill).length)
    check(levels.join() === '1,2,3,4', '各档信心度应按信号条数量辨认')
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

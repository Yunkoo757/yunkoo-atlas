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
    check(!document.querySelector('.status-icon.is-animate'), '首次挂载不能因 StrictMode 重放而启动动画')
    check(opacity() === .72, '静态亮度必须使用列表角色')
    document.querySelector<HTMLButtonElement>('#change-status')!.click()
    await wait()
    check(opacity() === .72 && !document.querySelector('.status-icon.is-animate'), '状态切换结束必须归还列表亮度')
    document.querySelector<HTMLButtonElement>('#row-focus')!.focus()
    await wait()
    check(opacity() === .92, '动画完成后行内聚焦应恢复交互亮度')
    document.querySelector<HTMLButtonElement>('#row-focus')!.blur()
    await wait()
    check(opacity() === .72, '离开行内聚焦应恢复静态亮度')
  } finally { root.unmount() }
})()

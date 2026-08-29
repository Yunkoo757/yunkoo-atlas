import { createRoot } from 'react-dom/client'
import { ToastHost } from '@/components/Toast'
import { toast, useToast } from '@/lib/toast'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __toastReceiptBrowserTest?: Promise<void>
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

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  let actionCalls = 0

  try {
    root.render(<ToastHost />)
    toast('已记录', {
      actionLabel: '打开记录',
      onAction: () => { actionCalls += 1 },
    })
    await waitFor(() => Boolean(document.querySelector('.toast-panel')), '通知回执没有出现')
    await waitFor(() => {
      const candidate = document.querySelector<HTMLElement>('.toast-panel')
      return candidate ? window.innerHeight - candidate.getBoundingClientRect().bottom >= 12 : false
    }, '通知回执入场后没有落在桌面安全边距内')

    const panel = document.querySelector<HTMLElement>('.toast-panel')
    assert(panel, '通知回执节点不存在')
    const bounds = panel.getBoundingClientRect()
    const style = getComputedStyle(panel)
    assert(bounds.width <= 390, `通知回执过宽：${bounds.width}px`)
    assert(bounds.height >= 42 && bounds.height <= 60, `单行通知回执高度失控：${bounds.height}px`)
    assert(window.innerWidth - bounds.right >= 12, '通知回执必须与桌面右边缘保留间距')
    assert(window.innerHeight - bounds.bottom >= 12, '通知回执必须与桌面底边保留间距')
    assert(style.animationName === 'toastIn', '通知回执必须使用 token 驱动的入场动效')
    assert(panel.dataset.state === 'active', '新通知必须处于 active 状态')

    document.querySelector<HTMLButtonElement>('.toast-action')?.click()
    assert(actionCalls === 1, '通知动作必须只执行一次')
    await waitFor(
      () => document.querySelector<HTMLElement>('.toast-panel')?.dataset.state === 'exiting',
      '通知动作完成后必须进入退场状态',
    )
    const exiting = document.querySelector<HTMLElement>('.toast-panel')
    assert(exiting && getComputedStyle(exiting).animationName === 'toastOut', '退场必须使用独立动效')
    await waitFor(() => !document.querySelector('.toast-panel'), '退场完成后通知仍占用 DOM')
  } finally {
    useToast.getState().dismiss()
    root.unmount()
  }
}

window.__toastReceiptBrowserTest = run()

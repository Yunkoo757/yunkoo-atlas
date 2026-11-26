import { createRoot } from 'react-dom/client'
import { ToastHost } from '@/components/Toast'
import { BatchActionBar } from '@/components/ui/BatchActionBar'
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

function overlaps(first: DOMRect, second: DOMRect): boolean {
  return first.left < second.right && second.left < first.right &&
    first.top < second.bottom && second.top < first.bottom
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
    const renderToastWithSelection = (count: number) => root.render(
      <><input aria-label="编辑复盘" /><ToastHost /><BatchActionBar count={count}><button>复制</button></BatchActionBar></>,
    )
    renderToastWithSelection(0)
    await waitFor(() => Boolean(rootElement.querySelector('input')), '缺少焦点参照')
    const editor = rootElement.querySelector('input')!
    editor.focus()
    const shortId = toast('复盘已完成', { tone: 'success' })
    await waitFor(() => Boolean(document.querySelector('.toast-panel.is-success')), '未显示成功回执')
    const short = document.querySelector<HTMLElement>('.toast-panel.is-success')!
    await Promise.all(short.getAnimations().map(animation => animation.finished))
    const shortBox = short.getBoundingClientRect()
    assert(shortBox.width < 210 && shortBox.height <= 40, '短成功回执应随文字收宽并保持紧凑')
    assert(window.innerWidth - shortBox.right >= 23 && window.innerHeight - shortBox.bottom >= 23, '回执应与右下窗口边缘保持安全距离')
    assert(short.getAttribute('role') === 'status' && short.getAttribute('aria-live') === 'polite', '成功回执应礼貌播报')
    assert(document.activeElement === editor, '成功回执出现时不得打断输入')
    assert(shortId !== null, '成功回执未入队')
    useToast.getState().dismiss(shortId)
    await waitFor(() => !document.querySelector('.toast-panel'), '成功回执没有退场')
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
    await Promise.all(panel.getAnimations().map(animation => animation.finished))
    const bounds = panel.getBoundingClientRect()
    const style = getComputedStyle(panel)
    assert(bounds.width < 260, `短操作回执未随内容收宽：${bounds.width}px`)
    assert(bounds.height >= 36 && bounds.height <= 50, `单行操作回执高度失控：${bounds.height}px`)
    assert(!panel.querySelector('.toast-icon'), '普通回执应直接显示内容')
    assert(style.animationName === 'toastIn', '通知回执必须使用 token 驱动的入场动效')
    assert(panel.dataset.state === 'active', '新通知必须处于 active 状态')

    const restingBottom = getComputedStyle(panel.parentElement!).bottom
    renderToastWithSelection(2)
    await waitFor(() => {
      const bar = document.querySelector('.batch-action-bar.is-floating')
      return Boolean(bar && panel.getBoundingClientRect().bottom + 4 <= bar.getBoundingClientRect().top)
    }, '浮动批量工具栏必须避开当前通知')
    renderToastWithSelection(0)
    await waitFor(() => getComputedStyle(panel.parentElement!).bottom === restingBottom, '取消选择后通知应回到底部')
    document.querySelector<HTMLButtonElement>('.toast-action')?.click()
    assert(actionCalls === 1, '通知动作必须只执行一次')
    await waitFor(
      () => document.querySelector<HTMLElement>('.toast-panel')?.dataset.state === 'exiting',
      '通知动作完成后必须进入退场状态',
    )
    const exiting = document.querySelector<HTMLElement>('.toast-panel')
    assert(exiting && getComputedStyle(exiting).animationName === 'toastOut', '退场必须使用独立动效')
    assert(exiting.inert && exiting.getAttribute('aria-hidden') === 'true', '退出中的通知不得继续响应操作或播报')
    await waitFor(() => !document.querySelector('.toast-panel'), '退场完成后通知仍占用 DOM')

    toast('归档文件暂时无法保存，请核对储存目录和可用空间后重试。'.repeat(3), {
      tone: 'error',
      actionLabel: '重试',
      onAction: () => { actionCalls += 1 },
    })
    await waitFor(() => Boolean(document.querySelector('.toast-panel[role="alert"]')), '错误应按警报播报')
    const error = document.querySelector<HTMLElement>('.toast-panel[role="alert"]')!
    await Promise.all(error.getAnimations().map(animation => animation.finished))
    const message = error.querySelector<HTMLElement>('.toast-message')!
    const action = error.querySelector<HTMLButtonElement>('.toast-action')!
    const close = error.querySelector<HTMLButtonElement>('button[aria-label="关闭通知"]')!
    assert(message && action && close, '持续错误须同时保留完整说明、操作与关闭入口')
    const errorBox = error.getBoundingClientRect()
    const messageBox = message.getBoundingClientRect()
    const actionBox = action.getBoundingClientRect()
    const closeBox = close.getBoundingClientRect()
    assert(errorBox.width <= 391 && message.scrollWidth <= message.clientWidth + 1, '长错误消息应在通知内换行')
    assert(messageBox.height > parseFloat(getComputedStyle(message).lineHeight) + 1 && message.scrollHeight <= message.clientHeight + 1, '长说明必须完整呈现多行')
    for (const box of [actionBox, closeBox]) {
      assert(box.left >= errorBox.left && box.top >= errorBox.top && box.right <= errorBox.right && box.bottom <= errorBox.bottom, '操作与关闭键都应位于通知内部')
      assert(!overlaps(messageBox, box), '按钮不得遮盖长说明')
    }
    assert(!overlaps(actionBox, closeBox), '重试与关闭的点击区域不得重叠')
    close.click()
    assert(actionCalls === 1, '关闭通知不应触发重试')
    await waitFor(() => !document.querySelector('.toast-panel'), '关闭后错误仍占用界面')
  } finally {
    useToast.getState().dismiss()
    root.unmount()
  }
}

window.__toastReceiptBrowserTest = run()

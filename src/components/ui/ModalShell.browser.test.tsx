import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ModalShell } from '@/components/ui/ModalShell'

declare global {
  interface Window {
    __modalShellBehaviorTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function pressKey(key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(event)
  return event
}

function bodyOverflow(): string {
  return document.body.style.overflow
}

function Harness() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <button type="button" id="modal-opener" onClick={() => setOpen(true)}>
        打开弹层
      </button>
      {open ? (
        <ModalShell
          title="确认恢复"
          description="验证共享弹层行为"
          busy={busy}
          onClose={() => setOpen(false)}
          footer={(
            <>
              <button type="button" data-autofocus onClick={() => setOpen(false)}>
                取消
              </button>
              <button type="button" id="modal-last-action" onClick={() => setBusy((value) => !value)}>
                切换忙碌
              </button>
            </>
          )}
        >
          <p>恢复会替换当前交易库。</p>
        </ModalShell>
      ) : null}
    </>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  root.render(<Harness />)

  try {
    await waitFor(() => Boolean(document.getElementById('modal-opener')), '弹层触发器没有渲染')
    const opener = document.getElementById('modal-opener') as HTMLButtonElement
    opener.focus()
    opener.click()

    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), '共享弹层没有打开')
    await waitFor(
      () => document.activeElement?.textContent?.trim() === '取消',
      '共享弹层没有优先聚焦安全操作',
    )
    assert(bodyOverflow() === 'hidden', '打开弹层时必须锁定页面滚动')

    const closeButton = document.querySelector<HTMLButtonElement>('.modal-shell-close')
    const lastAction = document.getElementById('modal-last-action') as HTMLButtonElement | null
    assert(closeButton && lastAction, '共享弹层缺少可聚焦边界控件')

    lastAction.focus()
    pressKey('Tab')
    assert(document.activeElement === closeButton, 'Tab 必须从末项循环到首项')
    closeButton.focus()
    pressKey('Tab', true)
    assert(document.activeElement === lastAction, 'Shift+Tab 必须从首项循环到末项')

    lastAction.click()
    await waitFor(
      () => document.querySelector('[role="dialog"]')?.getAttribute('aria-busy') === 'true',
      '忙碌状态没有同步到弹层语义',
    )
    const busyEscape = pressKey('Escape')
    assert(document.querySelector('[role="dialog"]'), '忙碌时 Escape 不应关闭弹层')
    assert(busyEscape.defaultPrevented, '忙碌时 Escape 仍需被弹层拦截')

    lastAction.click()
    await waitFor(
      () => document.querySelector('[role="dialog"]')?.getAttribute('aria-busy') !== 'true',
      '弹层没有退出忙碌状态',
    )
    pressKey('Escape')
    await waitFor(() => !document.querySelector('[role="dialog"]'), 'Escape 没有关闭空闲弹层')
    await waitFor(() => document.activeElement === opener, '关闭弹层后没有恢复触发器焦点')
    assert(bodyOverflow() === '', '关闭弹层后必须恢复页面滚动')
  } finally {
    root.unmount()
  }
}

window.__modalShellBehaviorTest = run()

import { nextFrame as waitForFrame, waitFor } from '../../test/browserTiming'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ModalShell } from '@/components/ui/ModalShell'
import { DialogSaveButton } from '@/components/ui/DialogSaveButton'
import { Select } from '@/components/ui/Select'

declare global {
  interface Window {
    __modalShellBehaviorTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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
  const [saves, setSaves] = useState(0)
  const [busy, setBusy] = useState(false)
  const [nestedOpen, setNestedOpen] = useState(false)
  const [selection, setSelection] = useState('one')

  return (
    <>
      <button type="button" id="modal-opener" onClick={() => setOpen(true)}>
        打开弹层
      </button>
      <output id="saves">{saves}</output>
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
              <DialogSaveButton onClick={() => setSaves(n => n + 1)}>保存</DialogSaveButton>
              <button type="button" id="modal-last-action" onClick={() => setBusy((value) => !value)}>
                切换忙碌
              </button>
            </>
          )}
        >
          <p>恢复会替换当前交易库。</p>
          <Select
            value={selection}
            ariaLabel="弹层内选择器"
            options={[
              { value: 'one', label: '第一项' },
              { value: 'two', label: '第二项' },
            ]}
            onValueChange={setSelection}
          />
          <button type="button" id="nested-modal-opener" onClick={() => setNestedOpen(true)}>
            打开二级确认
          </button>
          {nestedOpen ? (
            <ModalShell
              title="二级确认"
              size="compact"
              onClose={() => setNestedOpen(false)}
              footer={<>
                <button type="button" data-autofocus onClick={() => setNestedOpen(false)}>继续编辑</button>
                <button type="button" id="close-both" onClick={() => { setNestedOpen(false); setOpen(false) }}>全部关闭</button>
              </>}
            />
          ) : null}
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

    const selectTrigger = document.querySelector<HTMLButtonElement>('.ui-select-trigger')
    assert(selectTrigger, '弹层内选择器没有渲染')
    const saveFrom = (target: HTMLElement, options: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', metaKey: true, bubbles: true, cancelable: true, ...options,
    }))
    const saved = () => document.getElementById('saves')?.textContent
    saveFrom(selectTrigger, { isComposing: true })
    saveFrom(selectTrigger, { repeat: true })
    await waitForFrame()
    assert(saved() === '0', '选词或长按不应提交表单')
    assert(!document.querySelector('.ui-select-menu'), '确认输入法候选词不应打开选择器')
    saveFrom(selectTrigger)
    await waitFor(() => saved() === '1', '字段中的保存快捷键必须走实际主按钮')
    selectTrigger.click()
    await waitFor(() => Boolean(document.querySelector('.ui-select-menu')), '选择器弹层没有打开')
    const selectOption = document.querySelector<HTMLElement>('[role="option"]')
    assert(selectOption, '选择器缺少可聚焦选项')
    saveFrom(selectOption)
    await waitForFrame()
    assert(saved() === '1', '选项展开时不应提交底层表单')
    assert(document.querySelector('.ui-select-menu'), '保存快捷键不应替用户提交当前选项')
    const currentOption = document.querySelector<HTMLElement>('[role="option"]')!
    currentOption.focus()
    currentOption.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }))
    await waitFor(() => !document.querySelector('.ui-select-menu'), '第一次 Escape 没有优先关闭子弹层')
    assert(document.querySelector('[role="dialog"]'), '关闭子弹层时不应同时关闭父弹层')
    await waitFor(() => document.activeElement === selectTrigger, '关闭子弹层后没有归还选择器焦点')

    const nestedOpener = document.getElementById('nested-modal-opener') as HTMLButtonElement | null
    assert(nestedOpener, '缺少二级确认触发器')
    nestedOpener.click()
    await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 2, '二级确认没有打开')
    assert(!saveFrom(document.getElementById('close-both')!), '保存快捷键不应激活二级确认的默认按钮')
    await waitForFrame()
    assert(saved() === '1', '二级确认不应触发父表单保存')
    pressKey('Escape')
    await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 1, 'Escape 没有只关闭最上层确认')
    assert(document.querySelector('[role="dialog"]'), '关闭二级确认时父弹层不应关闭')

    const closeButton = document.querySelector<HTMLButtonElement>('.modal-shell-close')
    const lastAction = document.getElementById('modal-last-action') as HTMLButtonElement | null
    assert(closeButton && lastAction, '共享弹层缺少可聚焦边界控件')

    lastAction.focus()
    pressKey('Tab')
    assert(document.activeElement === closeButton, 'Tab 必须从末项循环到首项')
    closeButton.focus()
    pressKey('Tab', true)
    assert(document.activeElement === lastAction, 'Shift+Tab 必须从首项循环到末项')

    opener.focus()
    pressKey('Tab')
    assert(document.activeElement === closeButton, '焦点逸出 panel 后 Tab 必须拉回首项')
    opener.focus()
    pressKey('Tab', true)
    assert(document.activeElement === lastAction, '焦点逸出 panel 后 Shift+Tab 必须拉回末项')

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
    opener.click()
    await waitFor(() => !!document.getElementById('nested-modal-opener'), '无法再次打开一级弹层')
    document.getElementById('nested-modal-opener')!.click()
    await waitFor(() => !!document.getElementById('close-both'), '无法再次打开二级弹层')
    document.getElementById('close-both')!.click()
    await waitFor(() => !document.querySelector('[role="dialog"]'), '嵌套弹窗没有一起关闭')
    assert(bodyOverflow() === '', '同时关闭嵌套弹层时也必须释放滚动')
  } finally {
    root.unmount()
  }
}

window.__modalShellBehaviorTest = run()

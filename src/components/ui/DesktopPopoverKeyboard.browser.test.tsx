import { createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ContextMenu, type CtxItem } from '@/components/ContextMenu'
import { DatePicker } from '@/components/ui/DatePicker'
import { Select } from '@/components/ui/Select'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __desktopPopoverKeyboardTest?: Promise<void>
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

function press(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

const contextTriggerRef = createRef<HTMLButtonElement>()

function Harness() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const [date, setDate] = useState('2026-01-15')
  const [selectValue, setSelectValue] = useState('one')
  const contextItems: CtxItem[] = [
    { type: 'item', label: '第一项', onClick: () => undefined },
    { type: 'item', label: '不可用', disabled: true, onClick: () => undefined },
    { type: 'item', label: '最后一项', onClick: () => undefined },
  ]

  return (
    <main>
      <button
        ref={contextTriggerRef}
        id="context-trigger"
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setAnchor({ x: rect.left, y: rect.bottom + 4 })
        }}
      >
        打开菜单
      </button>
      <ContextMenu
        items={contextItems}
        anchor={anchor}
        restoreFocusRef={contextTriggerRef}
        onClose={() => setAnchor(null)}
      />
      <DatePicker
        value={date}
        ariaLabel="交易日期"
        onValueChange={setDate}
      />
      <Select
        value={selectValue}
        ariaLabel="交易类型"
        options={[
          { value: 'one', label: '实盘' },
          { value: 'two', label: '模拟' },
        ]}
        onValueChange={setSelectValue}
      />
    </main>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  root.render(<Harness />)

  try {
    await waitFor(() => Boolean(document.getElementById('context-trigger')), '测试控件没有渲染')
    const contextTrigger = document.getElementById('context-trigger') as HTMLButtonElement
    contextTrigger.focus()
    contextTrigger.click()
    await waitFor(() => document.activeElement?.getAttribute('role') === 'menuitem', '菜单没有聚焦首个可用项')
    const menu = document.querySelector<HTMLElement>('[role="menu"]')
    assert(menu, '菜单缺少 role=menu')
    press(menu, 'ArrowDown')
    assert(document.activeElement?.textContent?.includes('最后一项'), '方向键没有跳过禁用项')
    press(menu, 'End')
    assert(document.activeElement?.textContent?.includes('最后一项'), 'End 没有聚焦末项')
    press(menu, 'Home')
    assert(document.activeElement?.textContent?.includes('第一项'), 'Home 没有聚焦首项')
    press(menu, 'Escape')
    await waitFor(() => document.activeElement === contextTrigger, '关闭菜单后没有归还焦点')

    await waitFor(() => Boolean(document.querySelector('.ui-date-trigger')), '日期选择器未完成加载')
    const dateTrigger = document.querySelector<HTMLButtonElement>('.ui-date-trigger')
    assert(dateTrigger, '日期触发器不存在')
    dateTrigger.focus()
    press(dateTrigger, 'Enter')
    await waitFor(() => document.activeElement?.getAttribute('role') === 'gridcell', '日历没有聚焦活动日期')
    const calendar = document.querySelector<HTMLElement>('.ui-date-popover')
    assert(calendar, '日期弹层没有打开')
    const tabbableDays = () => [...calendar.querySelectorAll<HTMLElement>('[role="gridcell"]')]
      .filter((day) => day.tabIndex === 0)
    assert(tabbableDays().length === 1, `日历必须只有一个 roving tab stop，实际 ${tabbableDays().length}`)
    press(document.activeElement!, 'ArrowRight')
    await waitFor(
      () => document.activeElement?.getAttribute('aria-label') === '2026-01-16',
      'ArrowRight 日期错误',
    )
    press(document.activeElement!, 'ArrowDown')
    await waitFor(
      () => document.activeElement?.getAttribute('aria-label') === '2026-01-23',
      'ArrowDown 日期错误',
    )
    press(document.activeElement!, 'Home')
    await waitFor(
      () => document.activeElement?.getAttribute('aria-label') === '2026-01-19',
      'Home 没有移动到周首',
    )
    press(document.activeElement!, 'End')
    await waitFor(
      () => document.activeElement?.getAttribute('aria-label') === '2026-01-25',
      'End 没有移动到周末',
    )
    press(document.activeElement!, 'PageDown')
    await waitFor(
      () => document.activeElement?.getAttribute('aria-label') === '2026-02-25',
      'PageDown 没有在下个月保留日期',
    )
    assert(tabbableDays().length === 1, '翻月后 roving tab stop 不唯一')
    press(document.activeElement!, 'Escape')
    await waitFor(() => document.activeElement === dateTrigger, '关闭日历后没有归还焦点')

    dateTrigger.click()
    await waitFor(() => Boolean(document.querySelector('.ui-date-heading')), '日历年月入口缺失')
    document.querySelector<HTMLButtonElement>('.ui-date-heading')!.click()
    await waitFor(() => document.activeElement?.classList.contains('ui-date-year-input') === true, '年份输入未自动聚焦')
    const setYear = (value: string) => {
      const input = document.querySelector<HTMLInputElement>('.ui-date-year-input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setYear('0')
    await waitForFrame()
    press(document.activeElement!, 'Enter')
    await waitFor(() => Boolean(document.querySelector('.ui-date-year-error')), '无效年份必须在输入处说明')
    setYear('1988')
    await waitForFrame()
    press(document.activeElement!, 'Enter')
    await waitFor(() => Boolean(document.querySelector('[aria-label="选择月份"]')), '远年跳转后应选择月份')
    const february = Array.from(document.querySelectorAll<HTMLButtonElement>('.ui-date-period-grid button')).find((button) => button.textContent === '2月')!
    february.click()
    await waitFor(() => Boolean(document.querySelector('[data-day-key="1988-02-29"]')), '闰年二月日期未显示')
    assert(dateTrigger.textContent?.includes('2026-01-15'), '浏览年月不应提前提交日期')
    document.querySelector<HTMLButtonElement>('[data-day-key="1988-02-29"]')!.click()
    await waitFor(() => dateTrigger.textContent?.includes('1988-02-29') === true, '历史日期没有正确提交')
    dateTrigger.click()
    await waitFor(() => document.activeElement?.getAttribute('data-day-key') === '1988-02-29', '重新打开应定位已选历史日期')
    document.querySelector<HTMLButtonElement>('.ui-date-heading')!.click()
    await waitFor(() => Boolean(document.querySelector('.ui-date-year-input')), '年份页无法重新打开')
    press(document.activeElement!, 'Escape')
    await waitFor(() => document.activeElement === dateTrigger, '关闭年份页应归还焦点')
    assert(dateTrigger.textContent?.includes('1988-02-29'), '取消年份选择不能改变日期')

    assert(document.querySelector('.ui-select-trigger.ui-field-trigger'), 'Select 未消费 FieldTrigger')
    assert(document.querySelector('.ui-date-trigger.ui-field-trigger'), 'DatePicker 未消费 FieldTrigger')
  } finally {
    root.unmount()
  }
}

window.__desktopPopoverKeyboardTest = run()

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { CommandPalette } from '@/components/CommandPalette'
import { MobileNavigation } from '@/components/MobileNavigation'

declare global {
  interface Window {
    __commandPaletteAccessibilityTest?: Promise<void>
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

function pressKey(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

function Harness() {
  const [open, setOpen] = useState(false)
  const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null)
  return (
    <MemoryRouter initialEntries={['/list']}>
      <button id="command-opener" type="button" onClick={() => {
        setReturnFocusTo(null)
        setOpen(true)
      }}>
        打开命令面板
      </button>
      <MobileNavigation onOpenSearch={(target) => {
        setReturnFocusTo(target ?? null)
        setOpen(true)
      }} />
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        returnFocusTo={returnFocusTo}
      />
    </MemoryRouter>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  root.render(<Harness />)

  try {
    await waitFor(() => Boolean(document.getElementById('command-opener')), '命令面板触发器没有渲染')
    const opener = document.getElementById('command-opener') as HTMLButtonElement
    opener.focus()
    opener.click()

    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), '命令面板没有打开')
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')
    assert(input && listbox, '命令面板必须暴露 combobox 与 listbox 语义')
    await waitFor(() => document.activeElement === input, '命令面板没有聚焦搜索框')
    assert(input.getAttribute('aria-controls') === listbox.id, '搜索框必须关联结果列表')

    const firstActiveId = input.getAttribute('aria-activedescendant')
    assert(firstActiveId, '搜索框必须指向当前结果')
    assert(
      document.getElementById(firstActiveId)?.getAttribute('aria-selected') === 'true',
      '当前命令必须具有 option 选中语义',
    )

    pressKey(input, 'ArrowDown')
    await waitFor(
      () => input.getAttribute('aria-activedescendant') !== firstActiveId,
      '方向键没有移动当前命令',
    )

    const tab = pressKey(input, 'Tab')
    assert(tab.defaultPrevented, '单焦点组合框必须拦截 Tab，避免焦点逃出弹层')
    assert(document.activeElement === input, '结果项不应进入 Tab 序列，焦点必须留在组合框内')

    const escape = pressKey(input, 'Escape')
    assert(escape.defaultPrevented, 'Escape 必须由命令面板处理')
    await waitFor(() => !document.querySelector('[role="dialog"]'), 'Escape 没有关闭命令面板')
    await waitFor(() => document.activeElement === opener, '关闭命令面板后没有恢复触发器焦点')

    const more = document.querySelector<HTMLButtonElement>('.mobile-navigation-action[aria-label="更多"]')
    assert(more, '移动端更多入口没有渲染')
    more.click()
    await waitFor(
      () => Boolean(document.querySelector('section[role="dialog"][aria-label="更多"]')),
      '移动端更多面板没有打开',
    )
    const search = [...document.querySelectorAll<HTMLButtonElement>('[data-mobile-drawer-item]')]
      .find((button) => button.textContent?.trim() === '搜索')
    assert(search, '移动端更多面板缺少搜索入口')
    search.click()
    await waitFor(() => Boolean(document.querySelector('.cmdk')), '移动端搜索没有打开命令面板')
    const mobileInput = document.querySelector<HTMLInputElement>('.cmdk [role="combobox"]')
    assert(mobileInput, '移动端命令面板缺少搜索框')
    await waitFor(() => document.activeElement === mobileInput, '移动端命令面板没有聚焦搜索框')
    pressKey(mobileInput, 'Escape')
    await waitFor(() => !document.querySelector('.cmdk'), '移动端命令面板没有关闭')
    await waitFor(() => document.activeElement === more, '移动端命令面板关闭后没有返回“更多”入口')
  } finally {
    root.unmount()
  }
}

window.__commandPaletteAccessibilityTest = run()

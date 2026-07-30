import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { MissedOpportunityFilters } from '@/components/trades/MissedOpportunityFilters'
import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/views/MissedOpportunitiesView.css'

declare global {
  interface Window {
    __missedOpportunityFiltersDismissBrowserTest: Promise<void>
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

function filterTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="筛选错过机会"]')
  assert(trigger, '缺少错过机会筛选入口')
  return trigger
}

function filterClear(): HTMLButtonElement {
  const clear = document.querySelector<HTMLButtonElement>('.missed-filter-clear')
  assert(clear, '缺少清除筛选动作')
  return clear
}

async function openFilters(): Promise<HTMLElement> {
  filterTrigger().click()
  await waitFor(
    () => document.querySelector('[aria-label="错过机会筛选"]') !== null,
    '筛选面板未打开',
  )
  const panel = document.querySelector<HTMLElement>('[aria-label="错过机会筛选"]')
  assert(panel, '缺少错过机会筛选面板')
  return panel
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  const headingRef = createRef<HTMLHeadingElement>()

  try {
    root.render(
      <MemoryRouter initialEntries={['/missed']}>
        <button type="button" data-filter-outside>筛选面板外部</button>
        <MissedOpportunityFilters
          trades={[]}
          symbolCatalog={[]}
          resultCount={0}
          actions={null}
          headingRef={headingRef}
        />
      </MemoryRouter>,
    )

    await waitFor(() => document.querySelector('[aria-label="筛选错过机会"]') !== null, '筛选入口未渲染')
    await openFilters()
    const timeFilter = document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="时间"]')
    assert(timeFilter, '缺少时间筛选字段')
    assert(document.activeElement === timeFilter, '筛选面板打开后首字段必须获得焦点')

    assert(getComputedStyle(filterClear()).display === 'none', '无筛选时不得显示清除筛选动作')

    timeFilter.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }))
    await waitFor(() => document.querySelector('[aria-label="错过机会筛选"]') === null, 'Escape 未关闭筛选面板')
    await frame()
    assert(document.activeElement === filterTrigger(), 'Escape 关闭后必须把焦点还给筛选入口')

    await openFilters()
    const reopenedTimeFilter = document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="时间"]')
    assert(reopenedTimeFilter, '重新打开后缺少时间筛选字段')
    reopenedTimeFilter.click()
    await waitFor(() => document.querySelector('.ui-select-menu') !== null, '时间选项未打开')
    const today = document.querySelector<HTMLButtonElement>('.ui-select-menu [role="option"][data-value="today"]')
    assert(today, '时间筛选缺少今天选项')
    today.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    assert(document.querySelector('[aria-label="错过机会筛选"]'), 'Select 浮层交互不得关闭父筛选面板')
    today.click()
    await waitFor(() => reopenedTimeFilter.dataset.value === 'today', '时间筛选值未更新')
    assert(document.querySelector('[aria-label="错过机会筛选"]'), '选择筛选值后父面板不得关闭')
    await waitFor(() => getComputedStyle(filterClear()).display !== 'none', '存在筛选时必须显示清除动作')

    filterClear().click()
    await waitFor(() => getComputedStyle(filterClear()).display === 'none', '清除后必须隐藏清除动作')
    const outside = document.querySelector<HTMLButtonElement>('[data-filter-outside]')
    assert(outside, '缺少筛选面板外部目标')
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    await waitFor(() => document.querySelector('[aria-label="错过机会筛选"]') === null, '外部点击未关闭筛选面板')
  } finally {
    root.unmount()
  }
}

window.__missedOpportunityFiltersDismissBrowserTest = run()

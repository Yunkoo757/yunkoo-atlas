import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { useSaveStatus } from '@/store/saveStatus'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __saveStatusTransientDirtyTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await wait(16)
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  useSaveStatus.getState().reset()

  try {
    root.render(
      <MemoryRouter>
        <SaveStatusIndicator />
      </MemoryRouter>,
    )
    useSaveStatus.getState().setSaving()
    await wait(100)
    assert(!rootElement.textContent?.includes('保存中'), '快速保存不应闪烁')
    useSaveStatus.getState().setSaved()
    await wait(100)
    assert(!rootElement.textContent?.includes('已保存'), '自动保存成功应保持安静')
    useSaveStatus.getState().setDirty()

    await wait(100)
    assert(
      !rootElement.textContent?.includes('待保存'),
      '短暂的后台脏状态不应闪现待保存',
    )

    await waitFor(
      () => rootElement.textContent?.includes('待保存') ?? false,
      '持续等待自动保存的编辑必须得到明确反馈',
    )
    const indicator = rootElement.querySelector<HTMLElement>('.save-status[role="status"]')
    const title = indicator?.querySelector<HTMLElement>('.ui-inline-status-title')
    const clock = indicator?.querySelector('svg')
    assert(indicator && title && clock, '待保存应显示状态文案与共享时钟图标')
    const titleStyle = getComputedStyle(title)
    assert(clock.getBoundingClientRect().width === 14, '工具栏状态图标应用紧凑图标尺寸')
    assert(titleStyle.fontWeight === '400' && titleStyle.fontSize === getComputedStyle(indicator).fontSize, '工具栏状态必须采用辅助文字层级')
    const pendingWidth = indicator.getBoundingClientRect().width
    useSaveStatus.getState().setSaving()
    await waitFor(() => !!indicator.querySelector('.loading-indicator-motion'), '进入保存中后应复用加载图标')
    assert(Math.abs(indicator.getBoundingClientRect().width - pendingWidth) < 1, '待保存到写入时工具栏宽度不应跳动')
  } finally {
    root.unmount()
    useSaveStatus.getState().reset()
  }
}

window.__saveStatusTransientDirtyTest = run()

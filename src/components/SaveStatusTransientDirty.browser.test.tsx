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
    useSaveStatus.getState().setDirty()

    await wait(100)
    assert(
      !rootElement.textContent?.includes('未保存'),
      '短暂的后台脏状态不应闪现“未保存”',
    )

    await waitFor(
      () => rootElement.textContent?.includes('未保存') ?? false,
      '持续未保存的用户编辑必须得到明确反馈',
    )
  } finally {
    root.unmount()
    useSaveStatus.getState().reset()
  }
}

window.__saveStatusTransientDirtyTest = run()

import { MemoryAppRouter } from '@/test/fixtures/MemoryAppRouter'
import { createRoot } from 'react-dom/client'
import { Route, Routes } from 'react-router-dom'
import { QuickNotesView } from '@/views/QuickNotesView'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __quickNotesEmptyActionsTest?: Promise<void>
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function waitFor(check: () => boolean, message: string) {
  for (let index = 0; index < 120; index += 1) {
    if (check()) return
    await frame()
  }
  throw new Error(message)
}

async function run() {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)

  try {
    useStore.setState({ quickNotes: [] })
    root.render(
      <MemoryAppRouter initialEntries={['/notes']}>
        <Routes>
          <Route path="/notes" element={<QuickNotesView />} />
          <Route path="/notes/:id" element={<QuickNotesView />} />
        </Routes>
      </MemoryAppRouter>,
    )
    await waitFor(() => Boolean(document.querySelector('.quick-notes-empty')), '随记空状态未渲染')

    const createButtons = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.textContent?.trim() === '新建随记')
    assert(createButtons.length === 1, '空随记页面必须只保留一个新建主操作')
    assert(createButtons[0]?.closest('.quick-notes-empty'), '唯一的新建主操作必须位于空状态中心')
    createButtons[0].click()
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === '随记正文', '新建随记后应该能直接记录正文')
    const createAgain = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '新建随记')
    assert(createAgain, '须能再次从工具栏新建')
    createAgain.click()
    await frame()
    assert(useStore.getState().quickNotes.length === 1, '连续新建不能留下第二份空白随记')
    const input = document.querySelector<HTMLInputElement>('[aria-label="随记标题"]')!
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await frame()
    assert(input.value === '', '清空时须允许继续输入新标题')
    input.blur()
    await frame()
    assert(Boolean(input.value), '离开空标题后应显示自动标题')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__quickNotesEmptyActionsTest = run()

import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
      <MemoryRouter initialEntries={['/notes']}>
        <Routes>
          <Route path="/notes" element={<QuickNotesView />} />
          <Route path="/notes/:id" element={<QuickNotesView />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => Boolean(document.querySelector('.quick-notes-empty')), '随记空状态未渲染')

    const createButtons = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.textContent?.trim() === '新建随记')
    assert(createButtons.length === 1, '空随记页面必须只保留一个新建主操作')
    assert(createButtons[0]?.closest('.quick-notes-empty'), '唯一的新建主操作必须位于空状态中心')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__quickNotesEmptyActionsTest = run()

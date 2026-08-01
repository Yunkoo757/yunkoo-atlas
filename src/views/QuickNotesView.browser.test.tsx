import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QuickNotesView } from '@/views/QuickNotesView'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __quickNotesFocusBrowserTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitForSearch(): Promise<HTMLInputElement> {
  const deadline = performance.now() + 2_000
  while (performance.now() < deadline) {
    const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索随记"]')
    if (search) return search
    await frame()
  }
  throw new Error('随记页面缺少搜索框')
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  try {
    useStore.setState({ quickNotes: [] })
    root.render(
      <MemoryRouter initialEntries={['/notes']}>
        <QuickNotesView />
      </MemoryRouter>,
    )
    const search = await waitForSearch()
    search.focus()
    await frame()
    assert(document.activeElement === search, '随记搜索框未获得焦点')
    assert(search.autocomplete === 'off', '随记搜索框必须禁用浏览器自动填充，避免恢复内层字段背景')
    assert(getComputedStyle(search).boxShadow === 'none', '随记搜索框内部不得叠加第二层焦点阴影')
    assert(
      getComputedStyle(search.closest('.quick-notes-search')!).borderColor !== 'rgba(0, 0, 0, 0)',
      '随记搜索框外层必须保留可见焦点边框',
    )
  } finally {
    root.unmount()
    useStore.setState(previous)
  }
}

window.__quickNotesFocusBrowserTest = run()

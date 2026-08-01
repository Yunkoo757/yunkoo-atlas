import { createRoot } from 'react-dom/client'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QuickNotesView } from '@/views/QuickNotesView'
import { useStore } from '@/store/useStore'
import type { QuickNote } from '@/data/quickNotes'
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pressUndo(target: HTMLElement): void {
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'z',
    code: 'KeyZ',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }))
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

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 2_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  try {
    const previousNote: QuickNote = {
      id: 'previous-note',
      title: '上一条随记',
      titleMode: 'manual',
      contentHtml: '<p>上一条正文</p>',
      pinned: false,
      createdAt: '2026-08-01T14:00:00.000Z',
      updatedAt: '2026-08-01T14:00:00.000Z',
    }
    const currentNote: QuickNote = {
      id: 'current-note',
      title: '当前随记',
      titleMode: 'manual',
      contentHtml: '<p>不能丢失的当前正文</p>',
      pinned: false,
      createdAt: '2026-08-01T13:00:00.000Z',
      updatedAt: '2026-08-01T13:00:00.000Z',
    }
    useStore.setState({ quickNotes: [previousNote, currentNote] })
    root.render(
      <MemoryRouter initialEntries={['/notes/previous-note']}>
        <Routes>
          <Route path="/notes/:id" element={<QuickNotesView />} />
        </Routes>
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

    await waitFor(
      () => document.querySelector('[aria-label="随记正文"]')?.textContent === '上一条正文',
      '第一条随记正文没有加载完成',
    )
    const currentButton = [...document.querySelectorAll<HTMLButtonElement>('.quick-notes-list-item')]
      .find((button) => button.textContent?.includes('当前随记'))
    assert(currentButton, '随记列表缺少待切换条目')
    currentButton.click()
    await waitFor(
      () => document.querySelector('[aria-label="随记正文"]')?.textContent === '不能丢失的当前正文',
      '切换后的随记正文没有加载完成',
    )

    const editable = document.querySelector<HTMLElement>('[aria-label="随记正文"]')
    assert(editable, '无法取得随记正文编辑区')
    const editor = (editable as HTMLElement & { editor?: TiptapEditor }).editor
    assert(editor, '无法取得随记编辑器实例')
    editable.focus()
    pressUndo(editable)
    await frame()
    assert(
      editor.getText() === '不能丢失的当前正文',
      '切换随记后首次撤销不得恢复上一条随记正文',
    )

    editor.commands.focus('end')
    editor.commands.insertContent('临时输入')
    await waitFor(() => editor.getText().endsWith('临时输入'), '随记正文没有接受测试输入')
    pressUndo(editable)
    await waitFor(
      () => editor.getText() === '不能丢失的当前正文',
      '当前随记内 Ctrl+Z 必须撤销刚才的输入',
    )

    editor.commands.focus('end')
    editor.commands.insertContent('跨切换撤销')
    await waitFor(() => editor.getText().endsWith('跨切换撤销'), '跨切换撤销的测试输入没有写入')
    await delay(600)
    const previousButton = [...document.querySelectorAll<HTMLButtonElement>('.quick-notes-list-item')]
      .find((button) => button.textContent?.includes('上一条随记'))
    assert(previousButton, '随记列表缺少上一条随记')
    previousButton.click()
    await waitFor(
      () => document.querySelector('[aria-label="随记正文"]')?.textContent === '上一条正文',
      '没有成功切离编辑中的随记',
    )
    const currentButtonAfterSwitch = [...document.querySelectorAll<HTMLButtonElement>('.quick-notes-list-item')]
      .find((button) => button.textContent?.includes('当前随记'))
    assert(currentButtonAfterSwitch, '切换后随记列表缺少当前随记')
    currentButtonAfterSwitch.click()
    await waitFor(
      () => document.querySelector('[aria-label="随记正文"]')?.textContent === '不能丢失的当前正文跨切换撤销',
      '返回随记后没有恢复最新正文',
    )
    const returnedEditable = document.querySelector<HTMLElement>('[aria-label="随记正文"]')
    assert(returnedEditable, '返回随记后编辑器没有重新挂载')
    returnedEditable.focus()
    pressUndo(returnedEditable)
    await waitFor(
      () => returnedEditable.textContent === '不能丢失的当前正文',
      '切走再返回后 Ctrl+Z 必须恢复切换前的正文版本',
    )
  } finally {
    root.unmount()
    useStore.setState(previous)
  }
}

window.__quickNotesFocusBrowserTest = run()

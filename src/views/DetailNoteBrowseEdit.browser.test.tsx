import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { useShortcutHost } from '@/shortcuts/ShortcutHost'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { DetailView } from '@/views/DetailView'
import { getStorage } from '@/storage/provider'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { noteDraftKey, flushNoteDraftToStore, getNoteDraft, resetNoteDraftsForTests, setNoteDraft } from '@/storage/noteDrafts'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __detailNoteBrowseEditTest?: Promise<void>
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

function makeTrade(index: number): Trade {
  return {
    id: `note-browse-${index}`,
    ref: `TRD-BROWSE-${index}`,
    symbol: `EURUSD`,
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'uncategorized',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 1.1,
    exit: 1.2,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: `2026-09-0${index}`,
    closedAt: `2026-09-0${index}`,
    note: `<blockquote><p>浏览态正文 ${index}</p></blockquote>`,
  }
}

function ReturnPathProbe() {
  const location = useLocation()
  return <output data-testid="note-browse-return-path">{location.pathname}</output>
}

function ShortcutDetailFixture() {
  useShortcutHost({ onToggleCmdk: () => {} })
  return (
    <Routes>
      <Route path="/list" element={<ReturnPathProbe />} />
      <Route path="/trade/:id" element={<DetailView />} />
    </Routes>
  )
}

function press(key: string): void {
  const active = document.activeElement
  const target = active instanceof HTMLElement ? active : document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previousStore = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const trades = [makeTrade(1), makeTrade(2)]
  const root = createRoot(rootElement)

  try {
    useStore.setState({ trades })
    // 另一篇带未归一化附件的草稿不属于当前记录，也不应阻塞本次阅读。
    const unrelated = noteDraftKey('quickNote', 'unrelated-draft')
    setNoteDraft(unrelated, '<p>其他草稿</p><img src="blob:unavailable-draft-image">')
    useShortcutStore.setState({
      bindings: {
        ...previousShortcuts.bindings,
        'trade.prev': { key: 'q' },
        'trade.next': { key: 'e' },
        'trade.editNote': { key: 'enter' },
        'trade.backToList': { key: 'escape' },
      },
      listContext: {
        filter: { type: 'all' },
        listPath: '/list',
        listSearch: '',
        orderedIds: trades.map((item) => item.id),
      },
    })
    root.render(
      <MemoryRouter initialEntries={['/trade/TRD-BROWSE-1']}>
        <ShortcutDetailFixture />
      </MemoryRouter>,
    )

    await waitFor(
      () => document.querySelector('.ProseMirror')?.textContent?.includes('浏览态正文 1') ?? false,
      '详情正文未载入',
    )
    const editor = document.querySelector<HTMLElement>('.ProseMirror')
    assert(editor?.getAttribute('contenteditable') === 'true', '打开详情应可直接编辑')
    assert(!document.querySelector('[aria-label^="编辑正文"]'), '不应保留编辑正文开关')
    assert(!document.querySelector('[aria-label="完成编辑"]'), '不应保留完成编辑开关')
    assert(document.activeElement !== editor, '打开详情不得自动聚焦正文')

    assert(getNoteDraft(unrelated)?.includes('其他草稿'), '打开交易不能冲洗其他页面的未保存草稿')
    const before = editor?.textContent ?? ''
    press('e')
    await waitFor(
      () => document.querySelector('.ProseMirror')?.textContent?.includes('浏览态正文 2') ?? false,
      '未聚焦正文时按 E 应翻到下一条',
    )
    assert(
      !document.body.textContent?.includes(`${before}e`) &&
        document.activeElement !== document.querySelector('.ProseMirror'),
      '切换记录后不得自动聚焦正文',
    )

    const current = document.querySelector<HTMLElement>('.ProseMirror') as HTMLElement & { editor?: TiptapEditor }
    current.focus()
    assert(document.activeElement === current, '正文无需开关即可聚焦输入')
    assert(current.editor, '缺少 Tiptap 编辑器')
    current.editor.commands.insertContent('直接补充')
    assert(current.textContent?.includes('直接补充'), '正文应可直接补充')
    current.editor.commands.undo()
    assert(!current.textContent?.includes('直接补充'), '误输入应可撤销')
    current.editor.commands.insertContent('保存到第二笔')
    assert(await flushNoteDraftToStore(noteDraftKey('trade', trades[1].id)), '离开前应可保存草稿')
    assert(useStore.getState().trades[1].note.includes('保存到第二笔'), '正文修改应写入对应记录')
    assert(!useStore.getState().trades[0].note.includes('保存到第二笔'), '编辑不得写入前一笔记录')

    press('Escape')
    await waitFor(() => document.activeElement !== current, 'Esc 应移出正文焦点')
    press('Enter')
    await waitFor(
      () => {
        const note = document.querySelector<HTMLElement>('.ProseMirror')
        return note?.getAttribute('contenteditable') === 'true'
          && document.activeElement === note
      },
      'Enter 应聚焦正文',
    )

    press('q')
    await waitForFrame()
    assert(
      document.querySelector('.ProseMirror')?.textContent?.includes('浏览态正文 2') ?? false,
      '编辑态按 Q 不得翻到其他记录',
    )

    press('Escape')
    await waitFor(
      () => document.activeElement !== document.querySelector('.ProseMirror'),
      '第一次 Esc 应移出正文焦点',
    )
    assert(
      document.querySelector('.ProseMirror')?.textContent?.includes('浏览态正文 2') ?? false,
      '移出焦点后应留在当前记录',
    )

    press('Escape')
    await waitFor(
      () => document.querySelector('[data-testid="note-browse-return-path"]')?.textContent === '/list',
      '浏览态再按 Esc 应返回列表',
    )
  } finally {
    root.unmount()
    resetNoteDraftsForTests()
    useStore.setState({ trades: previousStore.trades })
    useShortcutStore.setState({
      bindings: previousShortcuts.bindings,
      listContext: previousShortcuts.listContext,
    })
  }
}

async function verifyReadOnlyRecovery(): Promise<void> {
  const record = makeTrade(3)
  record.note += '<img src="journal-asset://recoverable-image">'
  const original = useStore.getState().trades
  const storage = getStorage()
  const acquire = storage.acquireAssetObjectUrl
  let releaseRead!: () => void
  const pending = new Promise<void>(resolve => { releaseRead = resolve })
  let reads = 0
  let released = 0
  storage.acquireAssetObjectUrl = async () => {
    if (++reads === 1) return null
    await pending
    return { url: '/src/views/fixtures/browser-test-image.svg', release: () => { released++ } }
  }
  const root = createRoot(document.getElementById('root')!)
  try {
    useStore.setState({ trades: [record] })
    root.render(<MemoryRouter initialEntries={['/trade/' + record.ref]}><ShortcutDetailFixture /></MemoryRouter>)
    const retry = () => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('重新载入'))
    await waitFor(() => Boolean(retry()), '缺失附件时应可重新载入')
    const editor = document.querySelector<HTMLElement>('.ProseMirror')
    assert(editor && !editor.isContentEditable && editor.textContent?.includes('浏览态正文 3'), '缺图时应只读显示本笔原文')
    retry()!.click()
    await waitFor(() => reads === 2, '重试应重新读取附件')
    assert(editor.isConnected && !editor.isContentEditable && editor.textContent?.includes('浏览态正文 3'), '等待读取期间保留原只读正文')
    releaseRead()
    await waitFor(() => editor.isContentEditable && Boolean(editor.querySelector('img[data-asset-id]')), '恢复后同一编辑器应显示附件并接受输入')
    assert(useStore.getState().trades[0]?.note === record.note && !getNoteDraft(noteDraftKey('trade', record.id)), '重试不得将只读占位或显示地址写回')

    const damaged = makeTrade(4)
    damaged.note += '<img src="journal-asset://missing-image">'
    storage.acquireAssetObjectUrl = async () => null
    useStore.setState({ trades: [damaged] })
    root.render(<MemoryRouter key={damaged.id} initialEntries={['/trade/' + damaged.ref]}><ShortcutDetailFixture /></MemoryRouter>)
    const repair = () => [...document.querySelectorAll('button')].find(button => button.textContent === '移除缺失图片并继续编辑')
    await waitFor(() => Boolean(repair()), '缺图时应可明确选择移除引用')
    const latestNote = damaged.note + '<p>载入后的补充</p>'
    useStore.getState().updateNote(damaged.id, latestNote)
    repair()!.click()
    await waitFor(() => document.querySelector<HTMLElement>('.ProseMirror')?.isContentEditable === true && !repair(), '移除缺图后应可继续编辑')
    assert(useStore.getState().trades[0]?.note === latestNote.replace('<img src="journal-asset://missing-image">', ''), '只移除缺失引用，保留最新正文')
  } finally {
    releaseRead()
    root.unmount()
    storage.acquireAssetObjectUrl = acquire
    useStore.setState({ trades: original })
  }
  assert(released === 1, '离开正文时应归还恢复后持有的显示地址')
}

window.__detailNoteBrowseEditTest = run().then(verifyReadOnlyRecovery)

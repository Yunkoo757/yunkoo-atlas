import { createRoot } from 'react-dom/client'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createQuickNote } from '@/data/quickNotes'
import { createWeeklyReview, weekStartFor } from '@/data/weeklyReviews'
import { getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { getStorage } from '@/storage/provider'
import { replaceLibraryInStore } from '@/lib/snapshotStore'
import { pickPersisted } from '@/storage/persist'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'
import { noteDraftKey, getNoteDraft, setNoteDraft } from '@/storage/noteDrafts'
import { useStore } from '@/store/useStore'
import { QuickNotesView } from './QuickNotesView'
import { WeeklyReviewView } from './WeeklyReviewView'

declare global { interface Window { __noteLoadRecoveryTest?: Promise<void> } }

async function waitFor(check: () => boolean, message: string) {
  const deadline = performance.now() + 4000
  while (performance.now() < deadline) {
    if (check()) return
    await new Promise(resolve => requestAnimationFrame(resolve))
  }
  throw Error(message)
}

async function run() {
  const state = useStore.getState()
  const date = getTradingDayKey(new Date(), state.display.tradingDayStartHour)
  const review = { ...createWeeklyReview(weekStartFor(parseLocalDate(date)), state.currentLiveStageId), contentHtml: '<p>磁盘周复盘</p>' }
  const note = { ...createQuickNote(), title: '隔离随记', contentHtml: '<p>磁盘随记</p>' }
  const storage = getStorage()
  const acquire = storage.acquireAssetObjectUrl
  const url = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'], {type: 'image/svg+xml'}))
  try {
    useStore.setState({ weeklyReviews: [review], quickNotes: [note] })
    for (const fixture of [
      { path: '/weekly-review', editor: '周复盘正文', draftId: noteDraftKey('weeklyReview', review.id), element: <WeeklyReviewView /> },
      { path: '/notes/' + note.id, editor: '随记正文', draftId: noteDraftKey('quickNote', note.id), element: <QuickNotesView /> },
    ]) {
      let reads = 0
      storage.acquireAssetObjectUrl = async () => {
        if (++reads === 1) throw Error('隔离读取错误')
        if (reads === 2) return null
        return { url, release() {} }
      }
      const draft = '<p>会话中较新的判断</p><img src="journal-asset://recovery-fixture" />'
      setNoteDraft(fixture.draftId, draft)
      const root = createRoot(document.getElementById('root')!)
      const editor = () => document.querySelector<HTMLElement>(`[aria-label="${fixture.editor}"]`)
      const retry = () => [...document.querySelectorAll('button')].find(button => button.textContent === '重新载入')
      try {
        root.render(<MemoryRouter initialEntries={[fixture.path]}><Routes>
          <Route path={fixture.path.startsWith('/notes/') ? '/notes/:id' : fixture.path} element={fixture.element} />
        </Routes></MemoryRouter>)
        await waitFor(() => Boolean(retry()) && editor()?.isContentEditable === false, '读取出错时必须锁定编辑并提供重试')
        if (!editor()?.textContent?.includes('会话中较新的判断') || getNoteDraft(fixture.draftId) !== draft) {
          throw Error('读取失败必须保留原草稿并显示最新文字')
        }
        retry()!.click()
        await waitFor(() => reads === 2 && document.body.textContent!.includes('部分图片未载入'), '缺图时仍须留在同一记录并能再次重试')
        retry()!.click()
        await waitFor(() => editor()?.isContentEditable === true && !retry(), '附件恢复后应继续在原文编辑')
        if (!editor()?.textContent?.includes('会话中较新的判断')) throw Error('恢复后应保留草稿文字')
        if (getNoteDraft(fixture.draftId) !== draft) throw Error('重试读取不得提交或清空草稿')
      } finally {
        root.unmount()
      }
    }
  } finally {
    storage.acquireAssetObjectUrl = acquire
    URL.revokeObjectURL(url)
    useStore.setState(state, true)
  }
}
async function verifyLibraryReplacement() {
  const state = useStore.getState()
  const snapshot = pickPersisted(state)
  const date = getTradingDayKey(new Date(), state.display.tradingDayStartHour)
  const review = {
    ...createWeeklyReview(weekStartFor(parseLocalDate(date)), state.currentLiveStageId),
    contentHtml: '<p>源库周复盘</p>', executionScore: 3, riskScore: 4, emotionScore: 5,
    commitmentText: '先看结构', commitmentCriteria: '按计划执行',
  }
  const note = { ...createQuickNote(), title: '源库随记', titleMode: 'manual' as const, contentHtml: '<p>源库随记</p>' }
  const source = { ...snapshot, weeklyReviews: [review], quickNotes: [note], trades: [] }
  const target = { ...source, weeklyReviews: [{ ...review, contentHtml: '<p>目标库周复盘</p>' }],
    quickNotes: [{ ...note, title: '目标库标题', contentHtml: '<p>目标库随记</p>' }] }
  const storage = getStorage()
  const save = storage.saveAsset
  const failures: string[] = []
  try {
    for (const weekly of [true, false]) {
      replaceLibraryInStore(source)
      let writes = 0
      let release!: (id: string) => void
      const delayed = new Promise<string>(resolve => { release = resolve })
      storage.saveAsset = async () => { writes++; return delayed }
      const root = createRoot(document.getElementById('root')!)
      const editor = () => document.querySelector<HTMLElement>(weekly ? '[aria-label="周复盘正文"]' : '[aria-label="随记正文"]')
      const action = () => weekly
        ? [...document.querySelectorAll('button')].find(button => button.textContent === '完成本周复盘')
        : document.querySelector<HTMLButtonElement>('[data-note-convert-case]')
      const key = weekly ? noteDraftKey('weeklyReview', review.id) : noteDraftKey('quickNote', note.id)
      try {
        root.render(<MemoryRouter initialEntries={[weekly ? '/weekly-review' : '/notes/' + note.id]}><Routes>
          <Route path={weekly ? '/weekly-review' : '/notes/:id'} element={weekly ? <WeeklyReviewView /> : <QuickNotesView />} />
          <Route path="/trade/:id" element={<span>已跳转到案例</span>} />
        </Routes></MemoryRouter>)
        await waitFor(() => editor()?.textContent?.includes('源库') === true && Boolean(action()), '源库编辑器未就绪')
        if (!weekly) {
          const sourceEditor = (editor() as HTMLElement & { editor: TiptapEditor }).editor
          sourceEditor.commands.insertContent('源库撤销历史')
          const title = document.querySelector<HTMLInputElement>('[aria-label="随记标题"]')!
          title.focus()
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, '尚在输入的源库标题')
          title.dispatchEvent(new Event('input', { bubbles: true }))
        }
        setNoteDraft(key, '<p>等待落盘</p><img src="data:image/png;base64,AQID">')
        action()!.click()
        await waitFor(() => writes === 1, '提交应等待真实草稿保存')
        replaceLibraryInStore(target)
        await waitFor(() => editor()?.textContent?.includes('目标库') === true && editor()?.isContentEditable === true, '切库后应显示同 ID 目标正文')
        if (!weekly) {
          if (action()?.disabled) failures.push('旧转换锁挡住新库同 ID 随记')
          const title = document.querySelector<HTMLInputElement>('[aria-label="随记标题"]')
          if (title?.value !== '目标库标题') failures.push('旧输入覆盖显示的新库标题')
          editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
          if (!editor()?.textContent?.includes('目标库随记') || getNoteDraft(key)?.includes('源库')) failures.push('撤销跨库恢复旧正文')
        }
        release('old-library-asset')
        await waitForPendingStorageOperations()
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        if (useStore.getState().weeklyReviews[0].status !== 'draft') failures.push('旧操作完成了新库的周复盘')
        if (useStore.getState().trades.length !== 0) failures.push('旧操作从新库随记创建了案例')
        if (!editor()?.textContent?.includes('目标库')) failures.push('新库正文未在原路由就绪')
        action()?.click()
        await waitFor(() => weekly
          ? useStore.getState().weeklyReviews[0]?.status === 'completed'
          : useStore.getState().trades.length === 1, '新资料库应可独立完成或转换')
        await waitForPendingStorageOperations()
      } finally {
        release('old-library-asset')
        root.unmount()
      }
    }
  } finally {
    storage.saveAsset = save
    useStore.setState(state, true)
  }
  if (failures.length) throw Error(failures.join('、'))
}

window.__noteLoadRecoveryTest = run().then(verifyLibraryReplacement)

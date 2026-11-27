import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createQuickNote } from '@/data/quickNotes'
import { createWeeklyReview, weekStartFor } from '@/data/weeklyReviews'
import { getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { getStorage } from '@/storage/bootstrap'
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
window.__noteLoadRecoveryTest = run()

import { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { QuickNotesView } from './QuickNotesView'
import { createQuickNote } from '@/data/quickNotes'
import { buildQuickNoteRecord } from '@/lib/quickNoteRecordDraft'
import { createInitialLiveStage } from '@/lib/liveStages'
import { buildReviewAssessmentPatch, buildReviewSessionPool, DEFAULT_REVIEW_SESSION_FILTERS } from '@/lib/reviewSession'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage/provider'
import { collectAssetIdsFromHtml } from '@/storage/assets'
import { getNoteDraft, QUICK_NOTE_DRAFT_PREFIX } from '@/storage/noteDrafts'
import { isQuickNoteConverting } from '@/lib/quickNoteConversion'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'
import '@/styles/tokens.css'
import '@/styles/global.css'

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message) }
async function until(check: () => unknown, message: string) {
  const deadline = performance.now() + 4000
  while (performance.now() < deadline) { if (check()) return; await new Promise(resolve => requestAnimationFrame(resolve)) }
  throw Error(message)
}
function DetailProbe() { return <main data-converted-case-path>{useLocation().pathname}</main> }

async function run() {
  const previous = useStore.getState(), root = createRoot(document.getElementById('root')!)
  const storage = getStorage()
  await storage.open()
  const originalSaveAsset = storage.saveAsset
  let assetGate: { promise: Promise<void>; release: () => void; fail: boolean } | null = null
  let assetSaveCalls = 0
  const releaseAssetGate = () => { assetGate?.release(); assetGate = null }
  const delayAssetSave = (fail = false) => {
    let release!: () => void
    const promise = new Promise<void>(resolve => { release = resolve })
    assetGate = { promise, release, fail }
    return releaseAssetGate
  }
  storage.saveAsset = async (blob, mime) => {
    const gate = assetGate
    assetSaveCalls++
    if (gate) {
      await gate.promise
      if (gate.fail) throw Error('isolated image normalization failure')
    }
    return originalSaveAsset.call(storage, blob, mime)
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const image = canvas.toDataURL('image/png')
  let navigate: NavigateFunction | undefined
  const routeGate: { current: Promise<void> | null } = { current: null }
  function NavigationProbe() { navigate = useNavigate(); return null }
  function TargetProbe() { if (routeGate.current) throw routeGate.current; return <DetailProbe /> }
  const openNote = () => {
    if (navigate) navigate('/notes/case-conversion-note')
    else root.render(<MemoryRouter future={{ v7_startTransition: true }} initialEntries={['/notes/case-conversion-note']}><NavigationProbe /><Suspense fallback={<main data-route-loading />}><Routes><Route path="/notes/:id" element={<QuickNotesView />} /><Route path="/notes" element={<QuickNotesView />} /><Route path="/trade/:id" element={<TargetProbe />} /><Route path="/elsewhere" element={<main data-conversion-away />} /></Routes></Suspense></MemoryRouter>)
  }
  const note = { ...createQuickNote(), id: 'case-conversion-note', title: '结构观察', contentHtml: '<p>只在结构确认后参与。</p>' }
  const strategy = { id: 'isolated-strategy', name: '隔离策略', icon: 'target' as const, color: '#5e6ad2' }
  const stage = createInitialLiveStage('2026-01-01', '2026-01-01T00:00:00.000Z', 'isolated-stage')
  const oldCase = buildQuickNoteRecord({ note, kind: 'case', id: 'existing-case', ref: 'CAS-40', strategyId: strategy.id, symbol: 'XAUUSD', liveStageId: stage.id })
  try {
    useStore.setState({ quickNotes: [note], trades: [oldCase], strategies: [strategy], liveStages: [stage], currentLiveStageId: stage.id })
    openNote()
    await until(() => document.querySelector('[aria-label="随记正文"]')?.textContent === '只在结构确认后参与。', '随记正文尚未载入')
    const editable = document.querySelector<HTMLElement>('[aria-label="随记正文"]')! as HTMLElement & { editor?: TiptapEditor }
    assert(editable.editor, '缺少实际随记编辑器')
    editable.editor.commands.focus('end')
    editable.editor.commands.insertContent('这是转案例前最后补充的观察。')
    const finishCaseFlush = delayAssetSave()
    editable.editor.chain().setImage({ src: image }).createParagraphNear().run()
    const convert = document.querySelector<HTMLButtonElement>('[data-note-convert-case]')!
    const convertLive = document.querySelector<HTMLButtonElement>('[data-note-convert-live]')!
    assert(convert && !convert.disabled, '转为案例入口必须可用')
    convert.click()
    convert.click()
    convertLive.click()
    await until(() => assetSaveCalls === 1 && convert.disabled && convertLive.disabled, '图片冲洗期间两个转换按钮必须共用禁用状态')
    assert(useStore.getState().trades.length === 1, '图片未保存时不得提前创建记录')
    navigate!('/elsewhere')
    await until(() => document.querySelector('[data-conversion-away]') && !document.querySelector('[data-note-convert-case]'), '等待冲洗时必须真实卸载随记页面')
    openNote()
    await until(() => document.querySelector<HTMLButtonElement>('[data-note-convert-case]')?.disabled && document.querySelector<HTMLButtonElement>('[data-note-convert-live]')?.disabled, '重挂载后同随记的案例/交易入口必须共享在途锁')
    document.querySelector<HTMLButtonElement>('[data-note-convert-case]')!.click()
    document.querySelector<HTMLButtonElement>('[data-note-convert-live]')!.click()
    finishCaseFlush()
    await until(() => !!document.querySelector('[data-converted-case-path]'), '转案例后未进入新案例详情')
    assert(useStore.getState().trades.length === 2, '等待冲洗时双击及卸载重挂后的案例/交易点击只允许创建一个案例')
    const created = useStore.getState().trades.find(trade => trade.id !== oldCase.id)
    assert(created, '转案例必须通过现有store写入新记录')
    assert(created.ref === 'CAS-41' && created.tradeKind === 'case', '转案例使用独立编号序列且正确递增')
    assert(created.note.includes('这是转案例前最后补充的观察。'), '转换必须先提交仍未防抖落入store的随记正文')
    const firstAssetIds = collectAssetIdsFromHtml([created.note])
    assert(firstAssetIds.length === 1 && await storage.getAssetForExport(firstAssetIds[0]), '转换必须保留实际持久化的原图')
    assert(document.querySelector('[data-converted-case-path]')!.textContent === '/trade/CAS-41', '转换后导航到新案例编号')
    assert(created.caseType === 'exemplar' && created.masteryState === 'new' && created.reviewStatus === 'unreviewed', '新案例使用正常案例分类')
    assert(useStore.getState().quickNotes[0].id === note.id && useStore.getState().quickNotes[0].contentHtml === created.note, '转换保留原随记及其最新正文')
    const filters = { ...DEFAULT_REVIEW_SESSION_FILTERS, includeLiveTrades: false, includePaperTrades: false, reviewTiming: 'all' as const }
    const stageContext = { liveStages: [stage], currentLiveStageId: stage.id }
    assert(buildReviewSessionPool([created], filters, new Set(), '2026-11-12', 0, stageContext).length === 1, '新案例可进入正常的全部案例复盘池')
    useStore.getState().updateTradeData(created.id, buildReviewAssessmentPatch(created, 'mastered', new Date(), 0))
    const mastered = useStore.getState().trades.find(trade => trade.id === created.id)!
    assert(mastered.masteryState === 'mastered' && mastered.reviewCategory === 'mastered' && mastered.reviewStatus === 'reviewed' && mastered.nextReviewAt === null, '现有复盘评估接口继续同步案例掌握度与分类')
    assert(mastered.note === created.note && useStore.getState().trades.find(trade => trade.id === oldCase.id) === oldCase, '复盘评估不改写正文或已有案例')

    // A later deliberate conversion is allowed; a failed flush must release the shared lock.
    openNote()
    await until(() => !!document.querySelector<HTMLElement>('[aria-label="随记正文"]')?.isContentEditable, '重新打开随记未就绪')
    const retryEditor = (document.querySelector('[aria-label="随记正文"]') as HTMLElement & { editor?: TiptapEditor }).editor!
    const finishFailedFlush = delayAssetSave(true)
    retryEditor.chain().focus('end').insertContent('失败后仍需保留的观察。').setImage({ src: image }).createParagraphNear().run()
    const retryLive = document.querySelector<HTMLButtonElement>('[data-note-convert-live]')!
    const retryCase = document.querySelector<HTMLButtonElement>('[data-note-convert-case]')!
    const savesBeforeFailure = assetSaveCalls
    retryLive.click()
    retryLive.click()
    retryCase.click()
    await until(() => assetSaveCalls > savesBeforeFailure && retryLive.disabled && retryCase.disabled, '交易转换也必须在冲洗前取得同一把锁')
    finishFailedFlush()
    await until(() => !retryLive.disabled && !retryCase.disabled, '冲洗失败后finally必须释放转换锁供重试')
    assert(useStore.getState().trades.length === 2 && !document.querySelector('[data-converted-case-path]'), '冲洗失败不得创建或跳转到额外记录')
    assert(getNoteDraft(`${QUICK_NOTE_DRAFT_PREFIX}${note.id}`)?.includes('失败后仍需保留的观察。'), '冲洗失败必须保留最新正文草稿')
    assert(useStore.getState().trades.find(trade => trade.id === created.id)?.note === created.note, '转换失败不得覆盖已生成的案例和原图')
    retryLive.click()
    retryLive.click()
    retryCase.click()
    await until(() => !!document.querySelector('[data-converted-case-path]'), '修复保存后应允许正常重试转换')
    const live = useStore.getState().trades.find(trade => trade.tradeKind === 'live')
    assert(live?.ref === 'TRD-1' && useStore.getState().trades.length === 3, '后续主动转交易允许一次，连续点击不得新增重复案例或交易')
    assert(live.note.includes('失败后仍需保留的观察。'), '重试必须使用仍保留的最新草稿')
    const allAssetIds = collectAssetIdsFromHtml([live.note])
    assert(allAssetIds.length === 2 && (await Promise.all(allAssetIds.map(id => storage.getAssetForExport(id)))).every(Boolean), '重试必须保留旧图及本次新原图')
    assert(useStore.getState().quickNotes.length === 1 && useStore.getState().quickNotes[0].contentHtml === live.note, '跨次有意转换保留原随记而不复制随记')

    // Fast flush must not release while the old controls survive a suspended navigation.
    openNote()
    await until(() => !!document.querySelector<HTMLElement>('[aria-label="随记正文"]')?.isContentEditable, '快速转换前随记未就绪')
    let finishRoute!: () => void
    routeGate.current = new Promise<void>(resolve => { finishRoute = resolve })
    const fastCase = document.querySelector<HTMLButtonElement>('[data-note-convert-case]')!
    fastCase.click()
    await until(() => useStore.getState().trades.length === 4, '快速冲洗后应生成一条案例')
    assert(fastCase.isConnected && fastCase.disabled && isQuickNoteConverting(note.id), '成功转换到路由离开前必须继续持有锁并禁用旧控件')
    fastCase.click()
    document.querySelector<HTMLButtonElement>('[data-note-convert-live]')!.click()
    await new Promise(resolve => requestAnimationFrame(resolve))
    assert(useStore.getState().trades.length === 4, '快速冲洗后的连续点击不得生成第二条记录')
    routeGate.current = null
    finishRoute()
    await until(() => document.querySelector('[data-converted-case-path]') && !isQuickNoteConverting(note.id), '目标路由完成离开随记后必须释放成功锁')

    // Deleting the source during normalization must cancel, rather than revive its captured value.
    openNote()
    await until(() => !!document.querySelector<HTMLElement>('[aria-label="随记正文"]')?.isContentEditable, '删除来源前随记未就绪')
    const deleteEditor = (document.querySelector('[aria-label="随记正文"]') as HTMLElement & { editor?: TiptapEditor }).editor!
    const finishDeletedFlush = delayAssetSave()
    const savesBeforeDelete = assetSaveCalls
    deleteEditor.chain().focus('end').setImage({ src: image }).createParagraphNear().run()
    document.querySelector<HTMLButtonElement>('[data-note-convert-case]')!.click()
    await until(() => assetSaveCalls > savesBeforeDelete, '删除来源测试必须先进入慢冲洗')
    document.querySelector<HTMLButtonElement>('[aria-label="删除随记"]')!.click()
    await until(() => document.querySelector('[role="dialog"]'), '删除随记确认没有打开')
    const confirmDelete = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(item => item.textContent === '删除随记')!
    confirmDelete.click()
    await until(() => useStore.getState().quickNotes.length === 0, '来源随记必须真实删除')
    assert(getNoteDraft(`${QUICK_NOTE_DRAFT_PREFIX}${note.id}`) === undefined, '删除必须清除来源的内存草稿')
    let drained = false
    const draining = waitForPendingStorageOperations().then(() => { drained = true })
    await new Promise(resolve => requestAnimationFrame(resolve))
    assert(!drained, '退出和切库使用的pending屏障必须等待草稿已清除的在途转换')
    finishDeletedFlush()
    await draining
    await until(() => !isQuickNoteConverting(note.id), '来源消失后必须释放转换锁')
    assert(useStore.getState().trades.length === 4 && !document.querySelector('[data-converted-case-path]'), '来源已删不能从捕获旧值生成记录或跳转')
    assert((await Promise.all(allAssetIds.map(id => storage.getAssetForExport(id)))).every(Boolean), '删除来源和取消转换不得破坏已转换记录所用原图')
    useStore.getState().upsertQuickNote(note)
    openNote()
    await until(() => !!document.querySelector<HTMLElement>('[aria-label="随记正文"]')?.isContentEditable, '转换终结后重新写入的随记必须仍可编辑')
    document.querySelector<HTMLButtonElement>('[data-note-convert-case]')!.click()
    await until(() => document.querySelector('[data-converted-case-path]') && useStore.getState().trades.length === 5, '屏障排空后后续主动转换必须仍可正常写入')
    await waitForPendingStorageOperations()
  } finally {
    releaseAssetGate()
    storage.saveAsset = originalSaveAsset
    root.unmount()
    useStore.setState(previous, true)
  }
}

declare global { interface Window { __quickNoteCaseFlowTest?: Promise<void> } }
window.__quickNoteCaseFlowTest = run()

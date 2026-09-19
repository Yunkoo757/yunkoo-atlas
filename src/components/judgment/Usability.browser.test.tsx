import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import { JudgmentDeskView } from '@/views/JudgmentDeskView'
import { ShortcutsPanel } from '@/views/settings/ShortcutsPanel'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { getStorage } from '@/storage'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __judgmentUsabilityTest?: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message) }
async function waitFor(check: () => unknown, message: string) { const until = performance.now() + 4000; while (performance.now() < until) { if (check()) return; await new Promise(resolve => requestAnimationFrame(resolve)) } throw Error(message) }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(e => e.textContent?.trim() === label || e.getAttribute('aria-label') === label)!
const click = async (label: string) => { assert(button(label), `缺少按钮 ${label}`); button(label).click(); await new Promise(resolve => requestAnimationFrame(resolve)) }
function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) { const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) }

async function run() {
  const previous = useStore.getState(), shortcuts = useShortcutStore.getState(), storage = getStorage(), originalLoad = storage.getAssetObjectUrl
  const root = createRoot(document.getElementById('root')!)
  let fail = true
  storage.getAssetObjectUrl = async () => fail ? null : `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#888"/></svg>')}`
  const trade = createFullPersistedSnapshotFixture().trades[0]
  useStore.setState({ trades: [trade], judgmentDesk: { themes: [{ id: 't', title: '测试主题', understanding: '已有认识' }], samples: ['a', 'b'].map(id => ({ id, themeId: 't', title: id, createdAt: '2026-09-19T00:00:00Z', opinion: null, note: '已保存观察', reference: { answer: 'yes', reason: '已有依据', confirmedAt: '2026-09-19T00:00:00Z', needsReview: false }, images: ['1', '2'].map(n => ({ assetId: `asset-${id}-${n}`, sourceTradeId: trade.id })) })), attempts: [], currentThemeId: 't', currentSampleId: 'a' } })
  try {
    root.render(<MemoryRouter initialEntries={['/judgment-desk']}><Routes><Route path="/judgment-desk" element={<JudgmentDeskView />} /><Route path="/trade/:id" element={<Link to="/judgment-desk">返回判断台</Link>} /></Routes></MemoryRouter>)
    await waitFor(() => button('重新载入图片'), '图片失败没有重试入口')
    fail = false
    await click('重新载入图片')
    await waitFor(() => document.querySelector('.jd-image img'), '重试未恢复图片')
    await click('下一张图')
    await click('对照')
    const panels = () => [...document.querySelectorAll('.jd-panel')]
    await waitFor(() => panels().length === 2, '对照未打开')
    panels()[1].querySelector<HTMLButtonElement>('[aria-label="下一张图"]')!.click()
    await waitFor(() => panels().every(p => p.textContent?.includes('图 2 / 2')), '左右图页码未独立更新')
    const source = document.querySelector<HTMLButtonElement>('.jd-source-link')!; source.click()
    await waitFor(() => document.querySelector('a'), '来源未打开')
    document.querySelector<HTMLAnchorElement>('a')!.click()
    await waitFor(() => panels().length === 2 && panels().every(p => p.textContent?.includes('图 2 / 2')), '返回来源后丢失图片页码或对照状态')
    await click('参考：是')
    assert(document.querySelector('.jd-reference-details')?.textContent?.includes('已有依据'), '依据应可直接阅读')
    await click('编辑备注与参考判断')
    const note = document.querySelector<HTMLTextAreaElement>('textarea')!
    input(note, '尚未保存的新观察')
    await waitFor(() => note.value === '尚未保存的新观察', '未进入编辑')
    await click('取消')
    await waitFor(() => button('继续编辑'), '脏草稿未受保护')
    await click('继续编辑')
    assert(document.querySelector<HTMLTextAreaElement>('textarea')?.value === '尚未保存的新观察', '继续编辑丢失草稿')
    await click('取消'); await click('放弃修改')
    await waitFor(() => !document.querySelector('[role="dialog"]'), '放弃修改未关闭弹窗')
    assert(useStore.getState().judgmentDesk.samples[0].note === '已保存观察', '放弃修改改变了原记录')
    root.render(<ShortcutsPanel />)
    await waitFor(() => document.querySelector('[aria-label="查找快捷键"]'), '缺少快捷键检索')
    const search = document.querySelector<HTMLInputElement>('[aria-label="查找快捷键"]')!
    input(search, '判断台')
    await waitFor(() => document.querySelectorAll('.shortcuts-row').length === 9, '动作名检索不正确')
    input(search, '不存在的操作')
    await waitFor(() => document.body.textContent?.includes('没有匹配的快捷键'), '无结果状态缺失')
    await click('清除')
    assert(document.querySelectorAll('.shortcuts-row').length > 9, '清除查询未恢复完整列表')
  } finally { root.unmount(); storage.getAssetObjectUrl = originalLoad; useStore.setState(previous, true); useShortcutStore.setState(shortcuts, true) }
}
window.__judgmentUsabilityTest = run()

import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Editor as TiptapEditor } from '@tiptap/core'
import type { Trade } from '@/data/trades'
import { prepareCaseClipboard } from '@/lib/caseClipboard'
import type { CaseClipboardContent, CaseClipboardResult } from '@/lib/caseClipboardContract'
import { DetailView } from './DetailView'
import { useStore } from '@/store/useStore'
import { resetNoteDraftsForTests } from '@/storage/noteDrafts'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __detailClipboardTest?: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(condition: () => boolean, message: string) {
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message)
    await new Promise(requestAnimationFrame)
  }
}
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const trade: Trade = {
  id: 'clipboard-case', ref: 'CASE-CLIPBOARD', symbol: 'EURUSD', side: 'long', status: 'win', conviction: 'medium',
  strategyId: 'uncategorized', tags: [], mistakeTags: [], tradeKind: 'case', reviewStatus: 'reviewed', reviewCategory: 'normal',
  caseType: 'exemplar', masteryState: 'new', entry: 1, exit: 2, size: 1, pnl: 1, rMultiple: 1,
  openedAt: '2026-11-08', closedAt: '2026-11-08', sourceNoteHtml: '<p>冻结来源</p>', note: '<p>独立沉淀</p>' + '<p>长正文用于验证复制失败时仍能看到错误与重试入口。</p>'.repeat(40),
}

async function run() {
  let assetReads = 0
  const storage = { getAssetForExport: async (id: string) => { assetReads++; return id === 'chart' ? { id, mime: 'image/png', data: png } : null } }
  const input = '<p style="font-family:other" onclick="alert(1)">中文 &amp; emoji 📈</p><img src="blob:expired" data-asset-id="chart"><ol start="3"><li data-checked="true"><input type="checkbox">已检查</li></ol><script>alert(1)</script>'
  const prepared = await prepareCaseClipboard({ ...trade, symbol: '<标的>', sourceNoteHtml: '<h3>来源图</h3><img src="journal-asset://chart">' }, input, storage)
  assert(assetReads === 1, '同一附件应只读取一次')
  assert(prepared.html.includes('&lt;标的&gt;') && prepared.html.includes('中文 &amp; emoji 📈'), '标题转义且中文与 emoji 保留')
  assert(prepared.images.length === 2 && prepared.images.every(image => image.data === png && image.mime === 'image/png'), '来源和沉淀的原图必须独立保留原始文件字节')
  assert(!prepared.html.includes('<img') && !prepared.text.includes('[图片]'), '附件已独立保存，正文不得混入占位文字')
  assert(!/blob:|journal-asset:|onclick|<script|<input|style=|data-asset-id/.test(prepared.html), '导出不得包含临时地址、内部属性或脚本')
  assert(prepared.text.indexOf('来源复盘') < prepared.text.indexOf('案例沉淀') && prepared.text.includes('☑ 已检查'), '纯文本应保留来源顺序和检查状态')
  for (const html of ['<p></p>', '<img src="journal-asset://missing">', '<img src="https://example.com/private.png">', '<span data-missing-asset-id="lost">缺失图片</span>']) {
    let rejected = false
    try { await prepareCaseClipboard({ ...trade, sourceNoteHtml: '' }, html, storage) } catch { rejected = true }
    assert(rejected, '空正文、缺失图片和远程图片应拒绝，不能报告完整复制成功')
  }
  const imageOnly = await prepareCaseClipboard({ ...trade, sourceNoteHtml: '' }, `<img src="data:image/png;base64,${png}">`, storage)
  assert(imageOnly.images.length === 1 && imageOnly.images[0].data === png && !imageOnly.text.includes('[图片]'), '仅图片的案例应保留独立原图')
  const sourceOnly = await prepareCaseClipboard(trade, '<p></p>', storage)
  assert(sourceOnly.html.includes('来源复盘') && !sourceOnly.html.includes('案例沉淀'), '沉淀为空时保留有标识的来源，不生成空白小节')

  const previous = useStore.getState()
  const previousBridge = window.journalBridge
  const root = createRoot(document.getElementById('root')!)
  const calls: CaseClipboardContent[] = []
  let finish: ((result: CaseClipboardResult) => void) | undefined
  window.journalBridge = { isElectron: true, copyCaseContent: content => { calls.push(content); return new Promise(resolve => { finish = resolve }) } } as NonNullable<Window['journalBridge']>
  try {
    useStore.setState({ trades: [trade], display: { ...previous.display, reviewContextPinned: true } })
    root.render(<MemoryRouter initialEntries={['/trade/CASE-CLIPBOARD']}><Routes><Route path="/trade/:id" element={<DetailView />} /></Routes></MemoryRouter>)
    await waitFor(() => Boolean(document.querySelector('[aria-label="案例沉淀正文"][contenteditable="true"]')), '正文未载入')
    const editor = document.querySelector<HTMLElement>('[aria-label="案例沉淀正文"]') as HTMLElement & { editor: TiptapEditor }
    await waitFor(() => Boolean(editor.querySelector('section[data-review-context]')), '正文展示同步未完成')
    await new Promise(requestAnimationFrame)
    editor.editor.commands.insertContent('刚刚编辑')
    await waitFor(() => document.body.textContent?.includes('刚刚编辑') ?? false, '编辑未生效')
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '复制图文')!
    const main = document.querySelector<HTMLElement>('.dv-main')!
    main.scrollTop = main.scrollHeight
    button.click(); button.click()
    await waitFor(() => calls.length > 0, '未调用桌面剪贴板')
    assert(calls.length === 1 && calls[0].text.includes('刚刚编辑') && calls[0].text.includes('冻结来源'), '一键复制应包含未落盘的新正文和冻结来源，重复点击只执行一次')
    assert(button.disabled && button.getAttribute('aria-busy') === 'true', '复制期间应阻止重复提交')
    finish!({ ok: false, error: '测试复制失败，请重试' })
    await waitFor(() => Boolean(document.querySelector('[role="alert"]')?.textContent?.includes('测试复制失败')), '失败必须可见且保留重试入口')
    await waitFor(() => {
      const rect = document.querySelector('[role="alert"]')!.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= innerHeight
    }, '阅读长文后复制失败，错误也必须进入可见范围')
    await waitFor(() => !button.disabled, '失败后应可重试')
    assert(document.querySelector('[aria-label="案例沉淀正文"]')?.textContent?.includes('刚刚编辑'), '失败后应保留正文')
    button.click()
    await waitFor(() => calls.length === 2, '重试未执行')
    finish!({ ok: true })
    await waitFor(() => !button.disabled, '复制完成应恢复操作')
    assert(!document.querySelector('[role="alert"]'), '成功重试后应清除旧错误')
  } finally {
    root.unmount(); resetNoteDraftsForTests(); useStore.setState(previous); window.journalBridge = previousBridge
  }
}
window.__detailClipboardTest = run()

import { createRoot } from 'react-dom/client'
import { TagPresetsPanel } from './TagPresetsPanel'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'
import './SettingsLayout.css'
declare global { interface Window { __tagPresetsTest?: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(test: () => boolean) {
  const end = performance.now() + 5000
  while (!test()) { if (performance.now() > end) throw new Error('状态未更新'); await new Promise(requestAnimationFrame) }
}
function input(label: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
function click(label: string) { document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click() }
async function run() {
  const previous = useStore.getState()
  useStore.setState({ tagPresets: ['保留标签', ...Array.from({ length: 12 }, (_, i) => `普通${i}`)], mistakeTagPresets: ['保留标签', '错误1'] })
  const root = createRoot(document.getElementById('root')!)
  root.render(<TagPresetsPanel />)
  try {
    await waitFor(() => !!document.querySelector('[aria-label="新增普通标签"]'))
    input('新增普通标签', '未提交草稿')
    await new Promise(requestAnimationFrame)
    click('错误 / 违规 2')
    await waitFor(() => !!document.querySelector('[aria-label="普通标签"]')?.closest('[hidden]'))
    assert(!document.querySelector('[aria-label="错误 / 违规标签"]')?.closest('[hidden]'), '应只显示选中分类')
    click('普通标签 13')
    await new Promise(requestAnimationFrame)
    assert(document.querySelector<HTMLInputElement>('[aria-label="新增普通标签"]')?.value === '未提交草稿', '切换分类不能丢失草稿')
    input('搜索普通标签', '保留标签')
    await waitFor(() => document.querySelector('[aria-label="普通标签"] .tag-list')?.children.length === 1)
    const remove = document.querySelector<HTMLButtonElement>('[aria-label="普通标签"] .settings-tag-chip-remove')!
    remove.focus()
    assert(getComputedStyle(remove).opacity === '1', '删除操作必须能通过键盘发现')
    remove.click()
    await waitFor(() => !useStore.getState().tagPresets.includes('保留标签'))
    assert(useStore.getState().mistakeTagPresets.includes('保留标签'), '删除不能波及其他分类')
    const batch = document.querySelector<HTMLDetailsElement>('[aria-label="普通标签"] .tag-batch')!
    batch.open = true
    input('批量导入普通标签', '批量A,批量A,批量B')
    await new Promise(requestAnimationFrame)
    click('导入普通标签')
    await waitFor(() => useStore.getState().tagPresets.includes('批量B'))
    assert(useStore.getState().tagPresets.filter((tag) => tag === '批量A').length === 1, '单次批量导入应去重')
  } finally { root.unmount(); useStore.setState({ tagPresets: previous.tagPresets, mistakeTagPresets: previous.mistakeTagPresets }) }
}
window.__tagPresetsTest = run()

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TagEditor } from './TagEditor'
import { BoardCardTags } from './trades/BoardCardTags'
import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/views/BoardView.css'
import './trades/QuickViewBar.css'

declare global { interface Window { __tagEditorBrowserTest: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const wait = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
const long = '等待价格进入有效区域后确认结构与信号'.repeat(8)
function Fixture() {
  const [tags, setTags] = useState(['初始标签', long])
  return <>
    <div className="dv-props" style={{ width: 260 }}><TagEditor tags={tags} onAdd={tag => setTags(previous => [...previous, tag])} onRemove={tag => setTags(previous => previous.filter(item => item !== tag))} suggestions={Array.from({ length: 20 }, (_, index) => `标签${index}`)} presets={[long + '候选']} tone="diagnostic" /></div>
    <button id="outside">外部入口</button>
    <article className="bd-card" tabIndex={0} style={{ width: 230 }}><div className="bd-case-tags"><span className="bd-case-tag bd-card-timeframe">15M</span><BoardCardTags errors={['未等待确认', '技术分析错误']} tags={['MTF ORA', '普通标签', long]} /></div></article>
    <button className="bd-col-add">新增</button>
    <button className="quick-view-chip is-active">全部</button>
  </>
}
async function run() {
  const root = createRoot(document.getElementById('root')!)
  root.render(<Fixture />)
  await wait()
  await document.fonts.ready
  const add = () => document.querySelector<HTMLButtonElement>('.tag-add-btn')!
  const input = () => document.querySelector<HTMLInputElement>('.tag-input')!
  const key = async (key: string, composing = false) => { input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, isComposing: composing })); await wait() }
  const value = async (text: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text)
    input().dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
  }
  try {
    add().click(); await wait(); await value('拼音待确认')
    for (const command of ['Enter', 'Escape', 'ArrowDown']) await key(command, true)
    assert(input()?.value === '拼音待确认', '组合输入不能提交或取消编辑')
    assert(!document.querySelector('.tag-selected-row')!.textContent!.includes('拼音待确认'), '组合输入不能添加标签')
    await value('标签')
    for (let index = 0; index < 13; index++) await key('ArrowDown')
    const active = document.getElementById(input().getAttribute('aria-activedescendant')!)!
    const menu = document.getElementById(input().getAttribute('aria-controls')!)!
    assert(active && menu && menu.scrollTop > 0, '方向键选择必须滚动候选菜单')
    assert(active.getBoundingClientRect().bottom <= menu.getBoundingClientRect().bottom, '活动候选必须可见')
    const selected = active.textContent!
    await key('Enter')
    assert(document.querySelector('.tag-selected-row')!.textContent!.includes(selected), 'Enter 必须提交活动候选')
    assert(document.activeElement === add(), '提交后必须恢复添加入口焦点')
    add().click(); await wait(); await key('Escape')
    assert(document.activeElement === add(), '取消后必须恢复添加入口焦点')
    const remove = document.querySelector<HTMLButtonElement>('.tag-chip-remove')!
    remove.focus(); remove.click(); await wait()
    assert(document.activeElement?.classList.contains('tag-chip-remove'), '删除后必须聚焦相邻移除按钮')
    add().click(); await wait(); await value('失焦保存')
    const outside = document.getElementById('outside')!
    outside.focus(); await wait()
    assert(document.activeElement === outside, '普通失焦不能抢回焦点')
    assert(document.querySelector('.tag-selected-row')!.textContent!.includes('失焦保存'), '保留失焦保存行为')
    const preset = document.querySelector<HTMLButtonElement>('.tag-preset-label')!
    preset.focus(); preset.click(); await wait()
    assert(document.activeElement === add(), '预置项添加后恢复焦点')
    const longChip = [...document.querySelectorAll<HTMLElement>('.tag-chip')].find(el => el.textContent === long)!
    assert(longChip && parseFloat(getComputedStyle(longChip).borderTopLeftRadius) <= 8, '多行标签不能沿用全圆角')
    assert(longChip.scrollWidth <= longChip.clientWidth, '多行标签不能横向溢出')
    const rail = document.querySelector<HTMLElement>('.bd-tags-rail')!
    const more = rail.querySelector<HTMLElement>('.bd-tags-more')!
    const shown = rail.querySelectorAll(':scope > .bd-case-tag').length
    assert(Number(more.textContent!.slice(1)) + shown === 5, '看板剩余标签计数必须完整')
    assert(more.getAttribute('aria-label')!.includes(long), '折叠入口必须包含完整长标签')
    const timeframe = document.querySelector<HTMLElement>('.bd-card-timeframe')!
    assert(timeframe.scrollWidth <= timeframe.clientWidth, '看板周期不能被压缩裁字')
    for (const selector of ['.bd-col-add', '.bd-card', '.quick-view-chip']) {
      const element = document.querySelector<HTMLElement>(selector)!
      outside.focus()
      const before = getComputedStyle(element).backgroundColor + getComputedStyle(element).borderColor
      element.focus(); await wait()
      assert(element.matches(':focus-visible'), `${selector} 需要键盘焦点`)
      assert(getComputedStyle(element).opacity !== '0', `${selector} 聚焦不能透明`)
      assert(before !== getComputedStyle(element).backgroundColor + getComputedStyle(element).borderColor, `${selector} 必须提供焦点反馈`)
    }
  } finally { root.unmount() }
}
window.__tagEditorBrowserTest = run()

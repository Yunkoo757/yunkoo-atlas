import { createRoot } from 'react-dom/client'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { TradeRow } from '@/components/trades/TradeRow'
import '@/styles/tokens.css'
import '@/styles/global.css'
import './TradeList.css'

declare global {
  interface Window {
    __tradeRowPresentationBrowserTest: Promise<void>
    __atlasBrowserWaitForActions: () => Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

const strategy: Strategy = {
  id: 'row-presentation-strategy',
  name: '行展示策略',
  icon: 'target',
  color: '#5e6ad2',
}

function trade(id: string): Trade {
  return {
    id,
    ref: `ROW-${id.toUpperCase()}`,
    symbol: 'XAUUSD',
    side: 'long',
    status: 'missed',
    conviction: 'medium',
    strategyId: strategy.id,
    tags: ['普通标签'],
    mistakeTags: ['追单'],
    session: 'New York',
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-31T09:00:00',
    closedAt: '2026-07-31T10:00:00',
    missReason: 'hesitation',
    note: '<p>行展示 fixture</p>',
  }
}

function Fixture() {
  return (
    <div className="trade-list">
      <TradeRow
        trade={trade('default')}
        strategies={[strategy]}
        selected={false}
        focused={false}
        starred={false}
        onOpen={() => {}}
        onSelect={() => {}}
        onToggleStar={() => {}}
      />
      <TradeRow
        trade={trade('focused')}
        strategies={[strategy]}
        selected={false}
        focused
        starred={false}
        onOpen={() => {}}
        onSelect={() => {}}
        onToggleStar={() => {}}
      />
      <TradeRow
        trade={trade('selected')}
        strategies={[strategy]}
        selected
        focused={false}
        starred={false}
        onOpen={() => {}}
        onSelect={() => {}}
        onToggleStar={() => {}}
      />
    </div>
  )
}

function assertDefaultRowHoverUsesHoverToken(defaultRow: HTMLElement): void {
  const hoverTokenProbe = document.createElement('div')
  hoverTokenProbe.style.backgroundColor = 'var(--bg-hover)'
  document.body.append(hoverTokenProbe)

  try {
    assert(
      getComputedStyle(defaultRow, '::after').backgroundColor === getComputedStyle(hoverTokenProbe).backgroundColor,
      '默认行悬停底色必须等于 --bg-hover 的计算色',
    )
  } finally {
    hoverTokenProbe.remove()
  }
}

function computedColorFor(variable: string): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${variable})`
  document.body.append(probe)
  try {
    return getComputedStyle(probe).color
  } finally {
    probe.remove()
  }
}

function computedBorderColorFor(variable: string): string {
  const probe = document.createElement('span')
  probe.style.border = `1px solid var(${variable})`
  document.body.append(probe)
  try {
    return getComputedStyle(probe).borderTopColor
  } finally {
    probe.remove()
  }
}

function assertContextHierarchy(row: HTMLElement): void {
  const status = row.querySelector<HTMLElement>('.status-icon')!
  const side = row.querySelector<HTMLElement>('.side-tag.is-quiet')!
  const strategyEntry = row.querySelector<HTMLElement>('.trade-row-strategy')!
  const mistake = row.querySelector<HTMLElement>('.trade-row-tag.is-mistake')!
  const session = row.querySelector<HTMLElement>('.trade-row-tag.is-session')!
  const ordinary = row.querySelector<HTMLElement>('.trade-row-tag.is-tag')!
  assert(status && side && strategyEntry && mistake && session && ordinary, '列表层级 fixture 必须包含完整上下文')

  assert(getComputedStyle(status).opacity === '0.72', '静止状态图标必须以令牌化透明度退后')
  assert(getComputedStyle(side).color === computedColorFor('--direction-list-long'), '方向文字必须消费列表专用色')
  assert(getComputedStyle(ordinary).color === computedColorFor('--list-text-context'), '普通标签必须使用列表上下文灰阶')
  assert(getComputedStyle(ordinary).borderTopColor === 'rgba(0, 0, 0, 0)', '普通标签不得绘制胶囊轮廓')
  assert(getComputedStyle(session).borderTopColor === 'rgba(0, 0, 0, 0)', '时段信息不得绘制胶囊轮廓')
  assert(getComputedStyle(mistake).borderTopColor !== 'rgba(0, 0, 0, 0)', '诊断标签必须保留低强度语义边界')
  assert(
    getComputedStyle(strategyEntry).borderTopColor === computedBorderColorFor('--list-interactive-border-rest'),
    '策略入口必须消费统一的列表交互边界令牌',
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)

  try {
    root.render(<Fixture />)
    await frame()
    await frame()

    const defaultRow = document.querySelector<HTMLElement>('[data-trade-id="default"]')!
    const focusedRow = document.querySelector<HTMLElement>('[data-trade-id="focused"]')!
    const selectedRow = document.querySelector<HTMLElement>('[data-trade-id="selected"]')!
    const overlay = focusedRow.querySelector<HTMLButtonElement>('.trade-row-open')!
    assert(defaultRow && focusedRow && selectedRow && overlay, '三种标准行状态必须完整渲染')

    await window.__atlasBrowserWaitForActions()
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert(defaultRow.matches(':hover'), '浏览器 runner 必须执行声明的 Playwright hover()')
    assertDefaultRowHoverUsesHoverToken(defaultRow)
    assert(getComputedStyle(focusedRow, '::after').backgroundColor === 'rgba(0, 0, 0, 0)', '程序焦点不得留下悬空短线或整行底色')

    document.documentElement.dataset.keyboardNavigation = 'true'
    overlay.focus()

    assert(overlay.matches(':focus-visible'), 'fixture 必须进入可见焦点态')
    assert(getComputedStyle(overlay).outlineStyle === 'none', '整行入口不得绘制焦点外框')
    assert(getComputedStyle(focusedRow).boxShadow === 'none', '焦点行不得绘制亮边')
    assert(getComputedStyle(focusedRow, '::after').backgroundColor !== 'rgba(0, 0, 0, 0)', '真实键盘焦点必须以完整行底色表达，不能只显示悬空的左侧短线')
    assert(getComputedStyle(focusedRow, '::after').boxShadow !== 'none', '真实键盘焦点必须使用完整的内描边')
    assert(getComputedStyle(selectedRow, '::after').backgroundColor === 'rgba(0, 0, 0, 0)', '多选不得改变整行底色')
    assert(selectedRow.querySelector('.selection-box.is-selected'), '多选仍必须由复选框表达')
    assertContextHierarchy(selectedRow)
  } finally {
    delete document.documentElement.dataset.keyboardNavigation
    root.unmount()
  }
}

window.__tradeRowPresentationBrowserTest = run()

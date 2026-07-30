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
    tags: [],
    mistakeTags: [],
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

    overlay.focus()

    assert(overlay.matches(':focus-visible'), 'fixture 必须进入可见焦点态')
    assert(getComputedStyle(overlay).outlineStyle === 'none', '整行入口不得绘制焦点外框')
    assert(getComputedStyle(focusedRow).boxShadow === 'none', '焦点行不得绘制亮边')
    assert(getComputedStyle(focusedRow, '::after').backgroundColor === 'rgba(0, 0, 0, 0)', '程序焦点不得改变整行底色')
    assert(getComputedStyle(selectedRow, '::after').backgroundColor === 'rgba(0, 0, 0, 0)', '多选不得改变整行底色')
    assert(selectedRow.querySelector('.selection-box.is-selected'), '多选仍必须由复选框表达')
  } finally {
    root.unmount()
  }
}

window.__tradeRowPresentationBrowserTest = run()

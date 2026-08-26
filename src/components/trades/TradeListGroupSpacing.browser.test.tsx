import { createRoot } from 'react-dom/client'
import { useRef } from 'react'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { TradeList, type TradeListGroup } from '@/components/trades/TradeList'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/views/ListView.css'
import './TradeList.css'

declare global {
  interface Window {
    __tradeListGroupSpacingBrowserTest: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(check: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 120; index += 1) {
    if (check()) return
    await frame()
  }
  throw new Error(message)
}

const strategy: Strategy = {
  id: 'group-spacing-strategy',
  name: '月份间距策略',
  icon: 'target',
  color: '#5e6ad2',
}

function trade(id: string, openedAt: string, side: Trade['side']): Trade {
  return {
    id,
    ref: `TRD-${id.toUpperCase()}`,
    symbol: 'XAUUSD',
    side,
    status: 'win',
    conviction: 'medium',
    strategyId: strategy.id,
    session: 'London Open',
    timeframe: '1H',
    narrative: 'Bullish',
    psychology: 'Neutral',
    tags: ['fixture'],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewedAt: openedAt,
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: 110,
    stopLoss: 95,
    initialStopLoss: 95,
    size: 1,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: 2,
    resultSource: 'imported',
    openedAt,
    closedAt: openedAt,
    closedTradingDayKey: openedAt.slice(0, 10),
    note: '<p>月份分组间距 fixture</p>',
    comments: [],
    activities: [],
  }
}

const fixtureTrades = [
  trade('august-1', '2026-08-12T09:00:00.000Z', 'long'),
  trade('august-2', '2026-08-11T09:00:00.000Z', 'short'),
  trade('july-1', '2026-07-31T09:00:00.000Z', 'long'),
  trade('july-2', '2026-07-30T09:00:00.000Z', 'short'),
  trade('july-3', '2026-07-29T09:00:00.000Z', 'long'),
  trade('july-4', '2026-07-28T09:00:00.000Z', 'short'),
  trade('july-5', '2026-07-27T09:00:00.000Z', 'long'),
  trade('july-6', '2026-07-26T09:00:00.000Z', 'short'),
]

const groups: TradeListGroup[] = [
  {
    key: '2026-08',
    label: '2026 年 8 月',
    recency: 'current',
    items: fixtureTrades.slice(0, 2),
  },
  {
    key: '2026-07',
    label: '2026 年 7 月',
    recency: 'recent',
    items: fixtureTrades.slice(2),
  },
]

let createCount = 0

function Fixture() {
  const scrollParentRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={scrollParentRef}
      className="list-scroll"
      data-spacing-scroll-host
      style={{ width: 'calc(100vw - 48px)', height: 240, flex: 'none' }}
    >
      <TradeList
        groups={groups}
        strategies={[strategy]}
        focusedId={null}
        selectedIds={new Set()}
        starredIds={[]}
        scrollParentRef={scrollParentRef}
        onOpen={() => {}}
        onSelect={() => {}}
        onClearSelection={() => {}}
        onToggleStar={() => {}}
        onContextMenu={() => {}}
        onCreate={() => { createCount += 1 }}
      />
    </div>
  )
}

function assertButtonHitTarget(button: HTMLButtonElement, message: string): void {
  const rect = button.getBoundingClientRect()
  const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  assert(target && (target === button || button.contains(target)), message)
}

async function run(): Promise<void> {
  const host = document.getElementById('root')
  assert(host, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(host)

  try {
    useStore.setState({ trades: fixtureTrades, strategies: [strategy] })
    root.render(<Fixture />)
    await frame()
    await frame()

    const scrollHost = host.querySelector<HTMLElement>('[data-spacing-scroll-host]')
    const columns = host.querySelector<HTMLElement>('.trade-list-columns')
    const reference = host.querySelector<HTMLElement>('.trade-row-ref')
    const strategyCell = host.querySelector<HTMLElement>('.trade-row-strategy')
    const pnlCell = host.querySelector<HTMLElement>('.trade-row-pnl')
    const rCell = host.querySelector<HTMLElement>('.trade-row-r')
    const dateCell = host.querySelector<HTMLElement>('.trade-row-date')
    const headers = [...host.querySelectorAll<HTMLElement>('.trade-list-group-header')]
    const firstHeader = headers.find((header) => header.textContent?.includes('2026 年 8 月'))
    const secondHeader = headers.find((header) => header.textContent?.includes('2026 年 7 月'))
    assert(
      scrollHost && columns && reference && strategyCell && pnlCell && rCell && dateCell && firstHeader && secondHeader,
      '必须渲染列标题、关键交易列与两个真实月份分组',
    )
    assert(
      Math.abs(scrollHost.clientWidth - (window.innerWidth - 48)) <= 1 && scrollHost.clientHeight === 240,
      `fixture 必须消费当前 viewport，实际 ${scrollHost.clientWidth}×${scrollHost.clientHeight}px`,
    )
    assert(getComputedStyle(strategyCell).display !== 'none', '所有桌面宽度必须保留策略')
    assert(getComputedStyle(pnlCell).display !== 'none', '所有桌面宽度必须保留现金盈亏')
    assert(getComputedStyle(rCell).display !== 'none', '所有桌面宽度必须保留 R')
    assert(
      (window.innerWidth <= 1439) === (getComputedStyle(reference).display === 'none'),
      '中窄桌面宽度必须按合同隐藏编号',
    )
    assert(
      (window.innerWidth <= 1268) === (getComputedStyle(dateCell).display === 'none'),
      '只有紧凑桌面宽度可以视觉隐藏日期',
    )
    assert(
      scrollHost.scrollWidth <= scrollHost.clientWidth + 1,
      `目标桌面宽度不得横向溢出，实际 ${scrollHost.scrollWidth}/${scrollHost.clientWidth}`,
    )

    const list = host.querySelector<HTMLElement>('.trade-list[role="list"]')
    const firstTradeRow = host.querySelector<HTMLElement>('[data-trade-id="august-1"]')
    assert(list && firstTradeRow, '交易集合必须暴露统一的 list/listitem 语义')
    assert(columns.getAttribute('aria-hidden') === 'true', '纯视觉列标题必须退出无障碍树')
    assert(!host.querySelector('[role="row"], [role="columnheader"]'), '列表不得混入残缺表格语义')
    assert(firstTradeRow.getAttribute('role') === 'listitem', '交易行必须是列表项')
    assert(firstTradeRow.parentElement?.getAttribute('role') === 'presentation', '虚拟定位层不得重复列表项语义')
    assert(firstTradeRow.getAttribute('aria-posinset') === '2', '首条交易必须位于月份标题之后')
    assert(firstTradeRow.getAttribute('aria-setsize') === '10', '虚拟列表必须暴露完整集合大小')
    const describedBy = firstTradeRow.getAttribute('aria-describedby')
    assert(describedBy && document.getElementById(describedBy)?.textContent === '2026 年 8 月', '交易行必须关联所属月份')

    const initialGap = firstHeader.getBoundingClientRect().top - columns.getBoundingClientRect().bottom
    assert(Math.abs(initialGap - 4) <= 1, `列标题与月份条应相距 4px，实际 ${initialGap}px`)

    const firstVirtualHeader = firstHeader.parentElement
    const secondVirtualHeader = secondHeader.parentElement
    assert(firstVirtualHeader, '首个月份条必须有虚拟项父层')
    assert(secondVirtualHeader, '后续月份条必须有虚拟项父层')
    assert(
      firstVirtualHeader.classList.contains('trade-list-virtual-item'),
      '首个月份条必须由真实虚拟项承载',
    )
    assert(
      secondVirtualHeader.classList.contains('trade-list-virtual-item'),
      '后续月份条必须由真实虚拟项承载',
    )
    const secondHeaderStart = secondVirtualHeader.offsetTop
    assert(
      Math.abs(firstVirtualHeader.getBoundingClientRect().height - 44) <= 1,
      `月份虚拟项必须测量为 44px，实际 ${firstVirtualHeader.getBoundingClientRect().height}px`,
    )
    assert(
      Math.abs(firstHeader.getBoundingClientRect().height - 36) <= 1,
      `月份条内容高度必须保持 36px，实际 ${firstHeader.getBoundingClientRect().height}px`,
    )
    const secondGap = secondHeader.getBoundingClientRect().top
      - secondVirtualHeader.getBoundingClientRect().top
    const firstBottomGap = firstVirtualHeader.getBoundingClientRect().bottom
      - firstHeader.getBoundingClientRect().bottom
    assert(Math.abs(secondGap - 4) <= 1, `月份条上方应由虚拟项留出 4px，实际 ${secondGap}px`)
    assert(Math.abs(firstBottomGap - 4) <= 1, `月份条下方应由虚拟项留出 4px，实际 ${firstBottomGap}px`)

    const addButton = firstHeader.querySelector<HTMLButtonElement>('.trade-list-group-add')
    const toggleButton = firstHeader.querySelector<HTMLButtonElement>('.trade-list-group-toggle')
    assert(addButton && toggleButton, '月份条必须保留新建与折叠按钮')
    assertButtonHitTarget(addButton, '间距层不得覆盖月份条的新建按钮')
    addButton.click()
    assert(createCount === 1, '点击月份条的新建按钮必须继续触发 onCreate')

    assertButtonHitTarget(toggleButton, '间距层不得在月份条上形成透明点击空洞')
    toggleButton.click()
    await waitFor(() => toggleButton.getAttribute('aria-expanded') === 'false', '点击月份条必须折叠分组')
    await waitFor(
      () => !host.querySelector('[data-trade-id="august-1"]'),
      '折叠动画结束后首组交易行必须移出虚拟列表',
    )
    assert(
      Math.abs(firstHeader.getBoundingClientRect().top - columns.getBoundingClientRect().bottom - 4) <= 1,
      '折叠后首组间距不得跳位',
    )
    toggleButton.click()
    await waitFor(() => toggleButton.getAttribute('aria-expanded') === 'true', '再次点击月份条必须展开分组')
    await waitFor(() => {
      const row = host.querySelector<HTMLElement>('[data-trade-id="august-1"]')
      return Boolean(row?.parentElement && row.parentElement.getBoundingClientRect().height >= 43)
    }, '展开动画结束后首组交易行必须恢复完整高度')
    await waitFor(() => scrollHost.scrollHeight > scrollHost.clientHeight, 'fixture 必须真实触发虚拟滚动')

    scrollHost.scrollTop = scrollHost.scrollHeight - scrollHost.clientHeight
    scrollHost.dispatchEvent(new Event('scroll'))
    await frame()
    await frame()
    assert(
      scrollHost.scrollTop >= secondHeaderStart,
      `fixture 必须滚过第二组 sticky 阈值 ${secondHeaderStart}px，实际 ${scrollHost.scrollTop}px`,
    )

    const stickyHeader = host.querySelector<HTMLElement>(
      '.trade-list-virtual-item.is-sticky .trade-list-group-header',
    )
    assert(stickyHeader, '滚动到第二组后必须保留吸顶月份条')
    const stickyLabel = stickyHeader.querySelector('strong')?.textContent?.trim()
    assert(
      stickyLabel === '2026 年 7 月',
      `滚动到底部后必须由第二个月份接管 sticky，实际为 ${stickyLabel ?? '未知月份'}`,
    )
    const stickyGap = stickyHeader.getBoundingClientRect().top - columns.getBoundingClientRect().bottom
    assert(
      stickyHeader.getBoundingClientRect().top >= columns.getBoundingClientRect().bottom + 3,
      '吸顶月份条不得遮挡列标题',
    )
    assert(Math.abs(stickyGap - 4) <= 1, `吸顶月份条应保留 4px 上间距，实际 ${stickyGap}px`)
  } finally {
    root.unmount()
    useStore.setState({ trades: previous.trades, strategies: previous.strategies })
  }
}

window.__tradeListGroupSpacingBrowserTest = run()

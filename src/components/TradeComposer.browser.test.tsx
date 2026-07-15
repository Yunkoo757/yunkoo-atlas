import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { TradeComposer } from '@/components/TradeComposer'
import { useStore } from '@/store/useStore'

declare global {
  interface Window {
    __tradeComposerDefaultsTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitForSelector<T extends Element>(selector: string): Promise<T> {
  const deadline = performance.now() + 1000
  while (performance.now() < deadline) {
    const match = document.querySelector<T>(selector)
    if (match) return match
    await waitForFrame()
  }
  throw new Error(`未找到元素：${selector}`)
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 1000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)

  try {
    useStore.setState({
      composerOpen: true,
      composerTrade: null,
      composerKind: 'live',
      trades: [],
      strategies: [
        {
          id: 'strategy-first',
          name: '第一条策略',
          icon: 'target',
          color: '#5e6ad2',
        },
      ],
      symbolCatalog: ['BTCUSDT'],
    })

    root.render(
      <MemoryRouter initialEntries={['/list']}>
        <TradeComposer />
      </MemoryRouter>,
    )

    const details = await waitForSelector<HTMLButtonElement>('button[aria-label="更多信息"]')
    assert(details.getAttribute('aria-expanded') === 'false', '新建记录应默认收起非核心字段')
    assert(!document.querySelector('button[aria-label="参与波段级别"]'), '收起时不应展示波段级别')
    assert(!document.querySelector('button[aria-label="交易策略"]'), '收起时不应展示策略')
    details.click()

    const timeframe = await waitForSelector<HTMLButtonElement>(
      'button[aria-label="参与波段级别"]',
    )
    const strategy = await waitForSelector<HTMLButtonElement>('button[aria-label="交易策略"]')

    assert(timeframe.dataset.value === '', '新建记录不应默认归类为 4H')
    assert(timeframe.textContent?.includes('未设置'), '波段级别应明确显示未设置')
    assert(strategy.dataset.value === '', '新建记录不应自动选择第一条策略')
    assert(strategy.textContent?.includes('未设置'), '策略应明确显示未设置')

    const create = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '创建交易')
    assert(create, '新建记录应提供创建交易按钮')
    create.click()
    await waitFor(() => useStore.getState().trades.length === 1, '创建交易后没有写入记录')

    const created = useStore.getState().trades[0]
    assert(created, '应能读取刚创建的交易')
    assert(created.timeframe === undefined, '未选择波段级别时不应保存假默认值')
    assert(created.strategyId === 'uncategorized', '未选择策略时应保存为未分类')
    assert(created.entry === null, '未填写入场价时应保存为未知，而不是占位 0')
    assert(created.size === null, '未填写仓位时应保存为未知，而不是占位 0')

    useStore.setState({
      composerOpen: true,
      composerTrade: created,
      composerKind: created.tradeKind,
    })
    await waitForSelector('[role="dialog"]')
    await waitForFrame()
    const reopenedStrategy = await waitForSelector<HTMLButtonElement>(
      'button[aria-label="交易策略"]',
    )
    assert(reopenedStrategy.dataset.value === '', '重新编辑未分类记录时应继续保持未设置')
    assert(reopenedStrategy.textContent?.includes('未设置'), '重新编辑时不应把未分类显示为请选择')

    const classified = {
      ...created,
      timeframe: '1H',
      strategyId: 'strategy-first',
    }
    useStore.setState({ trades: [classified], composerTrade: classified })
    await waitForFrame()
    const explicitTimeframe = await waitForSelector<HTMLButtonElement>(
      'button[aria-label="参与波段级别"]',
    )
    const explicitStrategy = await waitForSelector<HTMLButtonElement>(
      'button[aria-label="交易策略"]',
    )
    assert(explicitTimeframe.dataset.value === '1H', '编辑时应尊重已有波段级别')
    assert(explicitStrategy.dataset.value === 'strategy-first', '编辑时应尊重已有策略')
  } finally {
    root.unmount()
    useStore.setState({
      composerOpen: previous.composerOpen,
      composerTrade: previous.composerTrade,
      composerKind: previous.composerKind,
      trades: previous.trades,
      strategies: previous.strategies,
      symbolCatalog: previous.symbolCatalog,
    })
  }
}

window.__tradeComposerDefaultsTest = run()

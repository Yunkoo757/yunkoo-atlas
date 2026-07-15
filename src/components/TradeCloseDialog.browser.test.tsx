import { createRoot } from 'react-dom/client'
import { TradeCloseDialog } from '@/components/TradeCloseDialog'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'

declare global {
  interface Window {
    __tradeCloseDualMetricsTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 1000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function enterValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  assert(setter, '浏览器不支持输入框原生 setter')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const trade: Trade = {
  id: 'dual-metrics-close',
  ref: 'TRD-DUAL',
  symbol: 'EURUSD',
  side: 'long',
  status: 'open',
  conviction: 'medium',
  strategyId: 'uncategorized',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: null,
  exit: null,
  size: null,
  pnl: null,
  rMultiple: null,
  openedAt: '2026-07-15',
  closedAt: null,
  note: '',
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)

  try {
    useStore.setState({
      trades: [trade],
      closeTradeRequest: { tradeId: trade.id },
      undoStack: [],
      redoStack: [],
    })
    root.render(<TradeCloseDialog />)

    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), '平仓弹窗没有打开')
    const pnlInput = document.querySelector<HTMLInputElement>('input[aria-label="盈亏金额"]')
    const rInput = document.querySelector<HTMLInputElement>('input[aria-label="R 倍数"]')
    assert(pnlInput, '平仓时应始终显示盈亏金额输入框')
    assert(rInput, '平仓时应始终显示 R 倍数输入框')

    enterValue(pnlInput, '500')
    enterValue(rInput, '2')
    const submit = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '确认平仓')
    assert(submit, '缺少确认平仓按钮')
    submit.click()

    await waitFor(() => useStore.getState().closeTradeRequest === null, '平仓结果没有提交')
    const closed = useStore.getState().trades[0]
    assert(closed?.pnl === 500, '盈亏金额必须保存')
    assert(closed?.rMultiple === 2, 'R 倍数必须与金额同时保存')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      closeTradeRequest: previous.closeTradeRequest,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
    })
  }
}

window.__tradeCloseDualMetricsTest = run()

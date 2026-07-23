import { createRoot } from 'react-dom/client'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { useStore } from '@/store/useStore'

declare global {
  interface Window {
    __businessDateAnchorTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  throw new Error(message)
}

function Probe() {
  const anchor = useBusinessDateAnchor()
  return <output data-testid="business-date">{anchor.currentTradingDayKey}</output>
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const NativeDate = Date
  let currentTime = new NativeDate(2026, 7, 3, 3, 59, 59, 999).getTime()
  class ControlledDate extends NativeDate {
    constructor(...args: unknown[]) {
      super(currentTime)
      return Reflect.construct(NativeDate, args.length === 0 ? [currentTime] : args, new.target)
    }
    static now(): number {
      return currentTime
    }
  }
  globalThis.Date = ControlledDate as DateConstructor
  const nativeSetTimeout = window.setTimeout.bind(window)
  const nativeClearTimeout = window.clearTimeout.bind(window)
  let boundaryCallback: (() => void) | null = null
  const boundaryTimerId = 424_242
  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (typeof handler === 'function' && (timeout ?? 0) >= 1_000) {
      boundaryCallback = () => handler(...args)
      return boundaryTimerId
    }
    return nativeSetTimeout(handler, timeout, ...args)
  }) as typeof window.setTimeout
  window.clearTimeout = ((id?: number) => {
    if (id === boundaryTimerId) boundaryCallback = null
    else nativeClearTimeout(id)
  }) as typeof window.clearTimeout
  const root = createRoot(rootElement)

  try {
    useStore.setState({
      display: { ...previous.display, tradingDayStartHour: 4 },
    })
    root.render(<Probe />)
    await waitFor(
      () => document.querySelector('[data-testid="business-date"]')?.textContent === '2026-08-02',
      '长驻页面在 04:00 前必须显示上一交易日',
    )
    await waitFor(() => boundaryCallback !== null, 'Hook 必须排程下一次交易日边界刷新')

    currentTime = new NativeDate(2026, 7, 3, 4, 0, 0, 0).getTime()
    const fireBoundary = boundaryCallback as (() => void) | null
    assert(fireBoundary, '缺少交易日边界回调')
    fireBoundary()
    await waitFor(
      () => document.querySelector('[data-testid="business-date"]')?.textContent === '2026-08-03',
      '页面持续停留跨过交易日边界后，定时器必须无需刷新自动更新',
    )
  } finally {
    root.unmount()
    window.setTimeout = nativeSetTimeout
    window.clearTimeout = nativeClearTimeout
    globalThis.Date = NativeDate
    useStore.setState({ display: previous.display })
  }
}

window.__businessDateAnchorTest = run()

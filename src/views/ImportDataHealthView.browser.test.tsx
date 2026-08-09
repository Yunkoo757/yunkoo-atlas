import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { PersistedTrade } from '@/storage/types'
import { useStore } from '@/store/useStore'
import { ImportDataHealthView } from '@/views/ImportDataHealthView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __importDataHealthViewTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 2_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

function trade(id: string, high: boolean): PersistedTrade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tags: high ? [] : ['notion-import'],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: '2025-11-03',
    closedAt: '2025-11-03',
    closedTradingDayKey: '2025-11-03',
    note: '',
    importProvenance: high ? {
      source: 'notion',
      importedAt: '2025-11-04T00:00:00.000Z',
      openedAtSource: 'notion-date',
      closedAtSource: 'missing-in-source',
    } : undefined,
  }
}

async function run(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)
  const original = [trade('high', true), trade('manual', false)]
  let submittedIds: readonly string[] = []
  let undoCalled = false
  try {
    useStore.setState((state) => ({
      trades: original,
      display: { ...state.display, tradingDayStartHour: 6 },
      cleanupCopiedCloseDates: async (tradeIds) => {
        submittedIds = tradeIds
        const selected = new Set(tradeIds)
        const before = original.filter((item) => selected.has(item.id))
        const after = before.map((item) => ({ ...item, closedAt: null, closedTradingDayKey: undefined }))
        const afterById = new Map(after.map((item) => [item.id, item]))
        const trades = original.map((item) => afterById.get(item.id) ?? item)
        useStore.setState({ trades })
        return { kind: 'committed' as const, before, after, trades, actionId: 'cleanup-action' }
      },
      undo: () => {
        undoCalled = true
        useStore.setState({ trades: original })
        return true
      },
    }))
    root.render(<MemoryRouter><ImportDataHealthView /></MemoryRouter>)
    await waitFor(() => document.querySelectorAll('[data-health-candidate]').length === 2, '必须显示两种置信等级候选')
    assert(document.body.textContent?.includes('高置信') && document.body.textContent?.includes('需人工核对'), '页面必须清楚展示置信等级')
    assert(document.body.textContent?.includes('Notion') && document.body.textContent?.includes('2025-11-03'), '页面必须显示来源和开平仓日')
    const high = document.querySelector<HTMLInputElement>('[data-health-select="high"]')
    const manual = document.querySelector<HTMLInputElement>('[data-health-select="manual"]')
    await waitFor(() => high?.checked === true, '高置信候选必须默认选中')
    assert(manual?.checked === false, '人工核对候选必须默认不选中')
    manual.click()
    document.querySelector<HTMLButtonElement>('[data-health-cleanup]')?.click()
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), '批量清理前必须显示确认对话框')
    document.querySelector<HTMLButtonElement>('[data-health-cancel]')?.click()
    await waitFor(() => !document.querySelector('[role="dialog"]'), '取消必须关闭对话框')
    assert(submittedIds.length === 0, '取消不得提交历史修改')
    document.querySelector<HTMLButtonElement>('[data-health-cleanup]')?.click()
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), '重新操作必须再次确认')
    document.querySelector<HTMLButtonElement>('[data-health-confirm]')?.click()
    await waitFor(() => submittedIds.length === 2, '确认后必须提交逐条选择结果')
    await waitFor(() => document.querySelectorAll('[data-health-candidate]').length === 0, '清理后候选必须从队列移除')
    await waitFor(() => Boolean(document.querySelector('[data-health-undo]')), '清理成功后必须提供撤销入口')
    const undo = document.querySelector<HTMLButtonElement>('[data-health-undo]')
    assert(undo, '清理成功后必须提供撤销入口')
    undo.click()
    await waitFor(() => undoCalled, '撤销入口必须调用指定清理 patch')
    await waitFor(() => document.querySelectorAll('[data-health-candidate]').length === 2, '撤销后逐字段恢复的记录必须重新出现')
    assert(document.documentElement.scrollWidth <= window.innerWidth, '数据健康页不得横向溢出')
  } finally {
    root.unmount()
    useStore.setState(previous)
  }
}

window.__importDataHealthViewTest = run()

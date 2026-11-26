import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { TradeTrashView } from './TradeTrashView'

declare global { interface Window { __trashSelectionTest: Promise<void> } }

function record(id: string, symbol: string): Trade {
  return {
    id, ref: id, symbol, tradeKind: 'live', status: 'planned', side: 'long', conviction: 'medium',
    strategyId: '', tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal',
    entry: 0, exit: null, size: 0, pnl: null, rMultiple: null, openedAt: '2026-08-01', closedAt: null,
    note: '', deletedAt: new Date().toISOString(), deletionId: 'deleted-' + id,
  }
}

async function waitFor(check: () => boolean, message: string) {
  for (let n = 0; n < 90; n++) {
    if (check()) return
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  throw new Error(message)
}

async function run() {
  const previous = useStore.getState()
  const root = createRoot(document.getElementById('root')!)
  const control = (selector: string) => document.querySelector<HTMLButtonElement>(selector)
  const search = (value: string) => {
    const field = document.querySelector<HTMLInputElement>('input[type="search"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  try {
    useStore.setState({ trades: [record('TRD-A', 'XAUUSD'), record('TRD-B', 'EURUSD')] })
    root.render(<MemoryRouter><TradeTrashView /></MemoryRouter>)
    await waitFor(() => !!control('.trash-select-all-label'), '回收站未就绪')
    search(' XAUUSD ')
    await waitFor(() => document.querySelectorAll('.trash-item').length === 1, '粘贴的空格影响匹配')
    control('.trash-select-all-label')!.click()
    await waitFor(() => !!control('.batch-action-bar .ui-btn-danger'), '应可批量操作当前品种')
    search('EURUSD')
    await waitFor(() => document.querySelector('.trash-item-id')?.textContent === 'TRD-B' && !control('.batch-action-bar .ui-btn-danger'), '不可见记录仍被选中')
    control('.trash-select-all-label')!.click()
    await waitFor(() => !!control('.batch-action-bar .ui-btn-danger'), '未选中当前匹配记录')
    control('.batch-action-bar .ui-btn-danger')!.click()
    await waitFor(() => document.querySelector('[role="dialog"] h2')?.textContent === '彻底删除 1 笔交易？', '确认数量须等于当前范围')
    control('[data-autofocus]')!.click()
    await waitFor(() => !document.querySelector('[role="dialog"]'), '取消须关闭确认')
    control('.batch-action-bar .ui-btn-ghost')!.click()
    await waitFor(() => !useStore.getState().trades.find(t => t.id === 'TRD-B')?.deletedAt, '未恢复选中的记录')
    if (!useStore.getState().trades.find(t => t.id === 'TRD-A')?.deletedAt) throw new Error('隐藏记录被恢复')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}
window.__trashSelectionTest = run()

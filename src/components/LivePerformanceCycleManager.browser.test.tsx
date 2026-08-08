import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { useToast } from '@/lib/toast'
import { disablePersistWrites, enablePersistWrites, pickPersisted } from '@/storage/persist'
import { getStorage } from '@/storage/provider'
import { StorageRevisionConflictError } from '@/storage/adapter'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __livePerformanceCycleManagerTest?: Promise<void>; __atlasBrowserAllowedErrors?: string[] } }
window.__atlasBrowserAllowedErrors = [
  'Persist failed Error: test cycle save failure',
  'Persist failed Error: test cycle rollback failure',
  'Persist failed StorageRevisionConflictError: Storage revision conflict',
]

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function frame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())) }
async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) { if (condition()) return; await frame() }
  throw new Error(message)
}
function addDays(dayKey: string, amount: number): string { const date = parseLocalDate(dayKey); date.setDate(date.getDate() + amount); return formatYmd(date) }
function text(): string { return document.body.textContent ?? '' }
function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const target = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)
  assert(target, `找不到按钮：${label}`)
  return target
}
function click(label: string, scope: ParentNode = document): void { button(label, scope).click() }
async function selectDate(dayKey: string): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="开始日期"]')
  assert(trigger, '找不到日期选择器')
  trigger.click()
  await waitFor(() => Boolean(document.querySelector(`[role="gridcell"][aria-label="${dayKey}"]`)), `日历没有显示 ${dayKey}`)
  document.querySelector<HTMLButtonElement>(`[role="gridcell"][aria-label="${dayKey}"]`)?.click()
}
function closedLive(id: string, day: string, patch: Partial<Trade> = {}): Trade {
  return { id, ref: `TRD-${id}`, symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium', strategyId: 'strategy-1', tradeKind: 'live', tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal', entry: 100, exit: 110, size: 1, pnl: 10, rMultiple: 1, resultSource: 'imported', openedAt: day, closedAt: day, closedTradingDayKey: day, note: '', ...patch }
}
async function openManager(): Promise<void> {
  const trigger = button('开启新一轮')
  trigger.focus(); trigger.click()
  await waitFor(() => Boolean(document.querySelector('[data-cycle-manager]')), '统计周期弹窗未打开')
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root'); assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState(); const storage = getStorage(); const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const day = getTradingDayKey(new Date(), previous.display.tradingDayStartHour)
  const firstStart = addDays(day, -3); const beforeFirst = addDays(firstStart, -1)
  const firstTriggerCycles = JSON.stringify(previous.livePerformanceCycles)
  const router = createMemoryRouter([{ path: '/dashboard', element: <Dashboard /> }], { initialEntries: ['/dashboard?kind=live&range=this-week'] })
  const root = createRoot(rootElement)
  try {
    disablePersistWrites()
    useStore.setState({
      trades: [
        closedLive('archived', beforeFirst), closedLive('current-on-start', firstStart),
        closedLive('missing-day', beforeFirst, { closedTradingDayKey: 'invalid' }),
        { ...closedLive('active', beforeFirst), status: 'open', exit: null, closedAt: null, pnl: null, rMultiple: null, resultSource: undefined },
        { ...closedLive('planned', beforeFirst), status: 'planned', exit: null, closedAt: null, pnl: null, rMultiple: null, resultSource: undefined },
        { ...closedLive('case', beforeFirst), tradeKind: 'case', sourceTradeId: 'archived' },
      ],
      strategies: [{ id: 'strategy-1', name: '测试策略', icon: 'target', color: '#5e6ad2' }], livePerformanceCycles: [], liveStatsStartTradingDayKey: addDays(firstStart, -20),
    })
    const immutable = JSON.stringify({ trades: useStore.getState().trades, risk: useStore.getState().liveStatsStartTradingDayKey })
    root.render(<RouterProvider router={router} />)
    await waitFor(() => text().includes('开启新一轮'), '空库没有显示创建入口')
    const trigger = button('开启新一轮'); await openManager()
    await waitFor(() => document.activeElement === document.querySelector('button[aria-label="开始日期"]'), '创建弹窗必须聚焦日期')
    assert(!document.querySelector('[aria-label*="统计周期"]'), '无障碍标签不得暴露统计周期术语')
    assert(!document.querySelector('input[aria-label="统计周期名称"]'), '重新开始不得要求名称输入')
    assert(document.querySelector('[role="dialog"]')?.getAttribute('aria-describedby'), '确认摘要必须关联到 aria-describedby')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => !document.querySelector('[data-cycle-manager]'), 'Escape 必须取消')
    await waitFor(() => document.activeElement === trigger, 'Escape 后必须恢复触发器焦点')

    await openManager(); await selectDate(firstStart)
    await waitFor(() => text().includes('归档已结束 1 笔') && text().includes('当前已结束 1 笔') && text().includes('进行中 2 笔') && text().includes('待整理 1 笔') && text().includes('关联案例 1 个') && text().includes('风险核算起点不变'), '确认摘要计数或风险说明错误')
    let releaseSave: () => void = () => undefined; let saves = 0
    storage.saveSnapshot = async () => { saves += 1; await new Promise<void>((resolve) => { releaseSave = resolve }) }
    enablePersistWrites(); click('确认重新开始')
    await waitFor(() => saves === 1, '确认没有开始持久化')
    assert(button('正在保存…').disabled && document.querySelector('[role="dialog"]')?.getAttribute('aria-busy') === 'true', '保存中必须明确 busy')
    releaseSave(); await waitFor(() => !document.querySelector('[data-cycle-manager]'), '成功后弹窗未关闭')
    assert(useStore.getState().livePerformanceCycles.length === 1, '确认后必须创建边界')
    assert(!router.state.location.search.includes('statsCycle='), '新周期必须将 URL 归一化为当前且不带 statsCycle')
    assert(JSON.stringify({ trades: useStore.getState().trades, risk: useStore.getState().liveStatsStartTradingDayKey }) === immutable, '创建不得改写交易或风险起点')
    storage.saveSnapshot = originalSaveSnapshot; disablePersistWrites()

    await openManager()
    await waitFor(() => Boolean(document.querySelector('button[aria-label="开始日期"]')), '已有边界时主入口必须直接进入开启新一轮确认')
    assert(!text().includes('管理统计周期'), '主入口不得先展示管理统计周期')
    click('取消'); await waitFor(() => !document.querySelector('[data-cycle-manager]') && document.activeElement === [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === '开启新一轮'), '取消创建必须关闭弹窗并恢复焦点')
    await openManager(); click('更多操作')
    await waitFor(() => Boolean([...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === '撤销最近一轮')), '更多操作菜单未打开')
    click('撤销最近一轮'); await waitFor(() => document.activeElement === [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === '确认撤销'), '撤销确认必须获得焦点')
    click('确认撤销'); await waitFor(() => useStore.getState().livePerformanceCycles.length === 0 && !document.querySelector('[data-cycle-manager]'), '撤销只能移除最新边界')
    assert(JSON.stringify({ trades: useStore.getState().trades, risk: useStore.getState().liveStatsStartTradingDayKey }) === immutable, '撤销不得改写交易或风险起点')

    await openManager(); await selectDate(firstStart)
    const beforeFailure = JSON.stringify(useStore.getState().livePerformanceCycles)
    saves = 0; storage.saveSnapshot = async () => { saves += 1; if (saves === 1) throw new Error('test cycle save failure') }
    enablePersistWrites(); click('确认重新开始')
    await waitFor(() => saves === 2 && useToast.getState().message === '实盘统计保存失败，原设置已保留', '保存失败必须持久化回滚并提示')
    assert(JSON.stringify(useStore.getState().livePerformanceCycles) === beforeFailure, '保存失败必须恢复内存边界')
    storage.saveSnapshot = async () => { saves += 1; throw new Error('test cycle rollback failure') }
    click('确认重新开始')
    await waitFor(() => useToast.getState().message === '实盘统计保存与回滚均失败，请重新打开应用核对当前设置', '回滚失败必须提示重新核对')

    const revisionedStorage = storage as typeof storage & {
      loadSnapshotEnvelope: () => Promise<{ revision: number; snapshot: ReturnType<typeof pickPersisted> | null }>
    }
    const originalLoadSnapshotEnvelope = revisionedStorage.loadSnapshotEnvelope.bind(revisionedStorage)
    const remoteSnapshot = {
      ...pickPersisted(useStore.getState()),
      trades: [closedLive('remote-winner', day)],
      livePerformanceCycles: [{ id: 'remote-cycle', name: '统计周期 远端', startTradingDayKey: firstStart, createdAt: '2026-08-08T00:00:00.000Z' }],
      profile: { ...useStore.getState().profile, displayName: '远端赢家' },
    }
    saves = 0
    storage.saveSnapshot = async () => { saves += 1; throw new StorageRevisionConflictError(4, 5) }
    revisionedStorage.loadSnapshotEnvelope = async () => ({ revision: 5, snapshot: remoteSnapshot })
    click('确认重新开始')
    await waitFor(
      () => useToast.getState().message === '当前实盘已被其他客户端更新，请重新打开核对',
      'revision conflict 必须提示重新核对',
    )
    assert(saves === 1, 'revision conflict 后不得尝试回滚或覆盖远端快照')
    assert(useStore.getState().trades[0]?.id === 'remote-winner', 'revision conflict 必须完整 hydrate 远端交易而非只替换周期')
    assert(useStore.getState().profile.displayName === '远端赢家', 'revision conflict 必须完整 hydrate 远端设置')
    assert(useStore.getState().livePerformanceCycles[0]?.id === 'remote-cycle', 'revision conflict 必须完整 hydrate 远端统计周期')
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert(saves === 1, 'hydrate 远端快照后不得由订阅自动覆盖远端数据')
    assert(Boolean(document.querySelector('[data-cycle-manager]')), 'revision conflict 后不得成功关闭弹窗')

    saves = 0
    revisionedStorage.loadSnapshotEnvelope = async () => { throw new Error('test remote snapshot load failure') }
    await selectDate(day)
    click('确认重新开始')
    await waitFor(
      () => useToast.getState().message === '实盘统计提交冲突，请重新打开应用核对当前设置',
      '远端快照读取失败必须提示重新核对',
    )
    assert(saves === 1, '远端快照读取失败后不得尝试回滚或覆盖远端快照')
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert(saves === 1, '远端快照读取失败后不得重新调度旧 pending 快照')
    revisionedStorage.loadSnapshotEnvelope = originalLoadSnapshotEnvelope
  } finally {
    storage.saveSnapshot = originalSaveSnapshot; disablePersistWrites(); useToast.getState().dismiss(); root.unmount()
    useStore.setState({ trades: previous.trades, strategies: previous.strategies, livePerformanceCycles: JSON.parse(firstTriggerCycles), liveStatsStartTradingDayKey: previous.liveStatsStartTradingDayKey })
  }
}
window.__livePerformanceCycleManagerTest = run()

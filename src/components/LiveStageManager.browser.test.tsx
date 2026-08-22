import React from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { CaseTrade, LiveTrade, PaperTrade, Trade, TradeKind, TradeStatus } from '@/data/trades'
import type { WeeklyReview } from '@/data/weeklyReviews'
import type { LiveStage } from '@/lib/liveStages'
import { disablePersistWrites } from '@/storage/persist'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { useStore } from '@/store/useStore'
import { LiveStageManager } from '@/components/LiveStageManager'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window { __liveStageManagerTest?: Promise<void> }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

function currentTrade(id: string, status: TradeStatus): LiveTrade
function currentTrade(id: string, status: TradeStatus, tradeKind: 'live'): LiveTrade
function currentTrade(id: string, status: TradeStatus, tradeKind: 'case'): CaseTrade
function currentTrade(id: string, status: TradeStatus, tradeKind: 'paper'): PaperTrade
function currentTrade(id: string, status: TradeStatus, tradeKind: TradeKind = 'live'): Trade {
  const base: Omit<PaperTrade, 'tradeKind'> = {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status,
    conviction: 'medium',
    strategyId: 'strategy-1',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-08-28',
    closedAt: null,
    note: '',
  }
  return tradeKind === 'paper'
    ? { ...base, tradeKind: 'paper' }
    : { ...base, tradeKind, liveStageId: 'stage-current' }
}

function currentReview(): WeeklyReview {
  return {
    id: 'weekly-review:stage-current:2026-08-24',
    liveStageId: 'stage-current',
    weekStart: '2026-08-24',
    weekEnd: '2026-08-30',
    status: 'draft',
    executionScore: null,
    riskScore: null,
    emotionScore: null,
    strengthTags: [],
    mistakeTags: [],
    highlightTradeIds: [],
    mistakeTradeIds: [],
    followUpTradeIds: [],
    contentHtml: '',
    commitmentText: '',
    commitmentCriteria: '',
    previousCommitmentResult: null,
    metricsSnapshot: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    completedAt: null,
  }
}

const stages: LiveStage[] = [{
  id: 'stage-old',
  sequence: 1,
  name: '第一次实盘',
  status: 'archived',
  startsOn: '2026-07-01',
  endsOn: '2026-07-31',
  createdAt: '2026-07-01T00:00:00.000Z',
  archivedAt: '2026-08-01T00:00:00.000Z',
}, {
  id: 'stage-current',
  sequence: 2,
  name: '第二次实盘',
  status: 'current',
  startsOn: '2026-08-01',
  endsOn: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  archivedAt: null,
}]

function text(): string { return document.body.textContent ?? '' }

function button(label: string): HTMLButtonElement {
  const target = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === label)
  assert(target, `找不到按钮：${label}`)
  return target
}

function changeInput(label: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  assert(input, `找不到输入框：${label}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function Harness() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>开启新实盘阶段</button>
      {open ? (
        <LiveStageManager currentTradingDayKey="2026-08-28" onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const snapshot = createFullPersistedSnapshotFixture()
  const root = createRoot(rootElement)
  const router = createMemoryRouter([{ path: '/', element: <Harness /> }], { initialEntries: ['/'] })
  try {
    disablePersistWrites()
    useStore.setState({
      liveStages: stages.map((stage) => ({ ...stage })),
      currentLiveStageId: 'stage-current',
      scheduledStageRollover: null,
      trades: [
        currentTrade('planned', 'planned'),
        currentTrade('open', 'open'),
        currentTrade('closed', 'win'),
        currentTrade('case', 'win', 'case'),
        { ...currentTrade('old', 'planned'), liveStageId: 'stage-old' },
        currentTrade('paper', 'planned', 'paper'),
      ],
      weeklyReviews: [currentReview()],
      weeklyRiskPreparations: [{ ...snapshot.weeklyRiskPreparations[0]!, liveStageId: 'stage-current' }],
      riskPolicyVersions: [{ ...snapshot.riskPolicyVersions[0]!, liveStageId: 'stage-current' }],
      monthlyRiskLimits: [{ ...snapshot.monthlyRiskLimits[0]!, liveStageId: 'stage-current' }],
      riskOverrideEvents: [{ ...snapshot.riskOverrideEvents[0]!, liveStageId: 'stage-current' }],
    })
    root.render(<RouterProvider router={router} />)
    await waitFor(() => Boolean(document.querySelector('button')), '入口未渲染')
    button('开启新实盘阶段').click()
    await waitFor(() => Boolean(document.querySelector('[data-live-stage-manager]')), '阶段管理弹窗未打开')

    assert(text().includes('当前阶段：第二次实盘'), '弹窗必须标识当前阶段')
    assert(text().includes('始于 8月1日'), '弹窗必须展示当前阶段开始日期')
    assert(text().includes('预计下周一 8月31日生效'), '弹窗必须使用权威下周一边界')
    assert(text().includes('实盘交易 3 笔'), '弹窗必须展示当前阶段实盘交易数量')
    assert(text().includes('实盘案例 1 个'), '弹窗必须展示当前阶段案例数量')
    assert(text().includes('周复盘 1 次'), '弹窗必须展示当前阶段周复盘数量')
    assert(text().includes('风险记录 4 条'), '弹窗必须展示当前阶段风险记录总数')
    assert(text().includes('计划中 1 笔'), '弹窗必须区分计划中阻断项')
    assert(text().includes('持仓中 1 笔'), '弹窗必须区分持仓中阻断项')
    assert(text().includes('当前阶段周复盘尚未完成'), '弹窗必须明确区分当前阶段周复盘阻断项')
    assert(text().includes('不会阻止预约'), '弹窗必须说明阻断项不阻止预约')
    assert(text().includes('交易、案例、周复盘和风险记录将归入当前阶段档案'), '弹窗必须解释归档范围')
    assert(text().includes('策略、标签、模板、随记和其他全局设置继续保留'), '弹窗必须解释保留范围')
    assert(text().includes('新阶段风险恢复为未建档'), '弹窗必须说明新阶段风险状态')
    assert(!document.querySelector('input[type="date"]'), '标准阶段管理不得出现任意日期选择')
    assert(!text().includes('重置实盘统计') && !text().includes('重置统计'), '阶段管理不得暴露旧重置文案')

    const stageBeforeRename = useStore.getState().liveStages[1]!
    const tradeBeforeRename = useStore.getState().trades[0]
    const scheduleBeforeRename = useStore.getState().scheduledStageRollover
    changeInput('阶段名称', '自由命名阶段')
    button('保存名称').click()
    await waitFor(() => useStore.getState().liveStages[1]?.name === '自由命名阶段', '阶段重命名未生效')
    const renamed = useStore.getState()
    assert(renamed.liveStages[1]?.startsOn === stageBeforeRename.startsOn, '重命名不得改变阶段日期')
    assert(renamed.liveStages[1]?.sequence === stageBeforeRename.sequence, '重命名不得改变阶段序号')
    assert(renamed.liveStages[1]?.status === stageBeforeRename.status, '重命名不得改变阶段状态')
    assert(renamed.trades[0] === tradeBeforeRename, '重命名不得改变实体归属')
    assert(renamed.scheduledStageRollover === scheduleBeforeRename, '重命名不得改变预约')

    await waitFor(() => !button('确认预约').disabled, '重命名保存完成后必须恢复预约操作')
    button('确认预约').click()
    await waitFor(() => useStore.getState().scheduledStageRollover !== null, '确认后必须创建预约')
    const scheduled = useStore.getState().scheduledStageRollover
    assert(scheduled?.effectiveWeekStart === '2026-08-31', '预约必须使用权威下周一')
    assert(text().includes('已有阶段切换预约'), '已预约时必须显示明确状态')
    assert(button('已预约').disabled, '已有预约不得被覆盖')

    useStore.getState().scheduleLiveStageRollover('2026-08-29', '2026-08-29T00:00:00.000Z')
    assert(useStore.getState().scheduledStageRollover === scheduled, '重复预约不得覆盖既有预约')
    await waitFor(() => !button('取消预约').disabled, '预约保存完成后必须允许取消')
    button('取消预约').click()
    await waitFor(() => useStore.getState().scheduledStageRollover === null, '耐久执行前必须允许取消预约')

    assert(document.documentElement.scrollWidth <= document.documentElement.clientWidth, '桌面宽度不得产生横向溢出')
  } finally {
    root.unmount()
    useStore.setState(previous)
  }
}

window.__liveStageManagerTest = run()

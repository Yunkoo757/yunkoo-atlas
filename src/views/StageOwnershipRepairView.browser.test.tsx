import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { StageOwnershipRepairView } from '@/views/StageOwnershipRepairView'
import { StageOwnershipHealthEntry } from '@/views/settings/DataSettingsPanel'
import { StorageRevisionConflictError } from '@/storage/adapter'
import { disablePersistWrites, enablePersistWrites, setPreFlushCallback } from '@/storage/persist'
import { getStorage } from '@/storage/provider'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import type { PersistedSnapshot } from '@/storage/types'
import { useStore } from '@/store/useStore'
import { useSaveStatus } from '@/store/saveStatus'
import {
  flushNoteDraftsToStore,
  hasNoteDraft,
  resetNoteDraftsForTests,
  setNoteDraft,
} from '@/storage/noteDrafts'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __stageOwnershipRepairViewBrowserTest?: Promise<void>
    __atlasBrowserAllowedErrors?: string[]
  }
}

window.__atlasBrowserAllowedErrors = [
  'Persist failed Error: repair persistence failure',
  'Persist failed StorageRevisionConflictError',
]

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

function trade(id: string, overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy-contract',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    liveStageId: null,
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: '2026-06-15',
    recordedAt: '2026-06-16T08:00:00.000Z',
    closedAt: '2026-06-17',
    closedTradingDayKey: '2026-06-17',
    note: '<p>迁移原始正文</p>',
    ...overrides,
  } as Trade
}

function seed(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const source = trade('source', { liveStageId: 'stage-old' })
  useStore.setState({
    liveStages: [{
      id: 'stage-old',
      sequence: 1,
      name: '历史训练期',
      status: 'archived',
      startsOn: '2026-06-01',
      endsOn: '2026-06-30',
      createdAt: '2026-06-01T00:00:00.000Z',
      archivedAt: '2026-07-01T00:00:00.000Z',
    }, {
      id: 'stage-current',
      sequence: 2,
      name: '当前执行期',
      status: 'current',
      startsOn: '2026-07-01',
      endsOn: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      archivedAt: null,
    }],
    currentLiveStageId: 'stage-current',
    trades: [
      trade('live'),
      trade('missed', { status: 'missed', missReason: 'hesitation' }),
      source,
      trade('case', { tradeKind: 'case', sourceTradeId: source.id }),
    ],
    weeklyReviews: [{
      ...fixture.weeklyReviews![0]!,
      id: 'review',
      liveStageId: null,
      weekStart: '2026-06-08',
      weekEnd: '2026-06-14',
    }],
    weeklyRiskPreparations: [{
      ...fixture.weeklyRiskPreparations[0]!,
      id: 'preparation',
      liveStageId: null,
      weekStart: '2026-06-08',
      confirmedPolicyVersionId: 'policy-source',
    }],
    riskPolicyVersions: [{
      ...fixture.riskPolicyVersions[0]!,
      id: 'policy',
      liveStageId: null,
      sourceWeekStart: '2026-06-08',
      effectiveTradingDay: '2026-06-09',
    }],
    monthlyRiskLimits: [{
      ...fixture.monthlyRiskLimits[0]!,
      id: 'limit',
      liveStageId: null,
      monthKey: '2026-06',
      sourcePolicyVersionId: 'policy-source',
    }],
    riskOverrideEvents: [{
      ...fixture.riskOverrideEvents[0]!,
      id: 'override',
      liveStageId: null,
      tradeId: source.id,
      policyVersionId: 'policy-source',
      tradingDayKeyAtDecision: '2026-06-17',
    }],
  })
}

function Harness() {
  return (
    <MemoryRouter initialEntries={['/settings/data/stage-ownership-repair']}>
      <aside data-health-fixture><StageOwnershipHealthEntry /></aside>
      <Routes>
        <Route path="/settings/data/stage-ownership-repair" element={<StageOwnershipRepairView />} />
      </Routes>
    </MemoryRouter>
  )
}

function row(entityId: string): HTMLElement {
  const target = document.querySelector<HTMLElement>(`[data-stage-ownership-id="${entityId}"]`)
  assert(target, `找不到待整理项：${entityId}`)
  return target
}

function selectStage(entityId: string, liveStageId: string): void {
  const select = row(entityId).querySelector<HTMLSelectElement>('select')
  assert(select, `${entityId} 缺少目标阶段选择框`)
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, liveStageId)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function saveButton(entityId: string): HTMLButtonElement {
  const button = row(entityId).querySelector<HTMLButtonElement>('button[data-stage-ownership-save]')
  assert(button, `${entityId} 缺少保存按钮`)
  return button
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const saved: PersistedSnapshot[] = []
  let saveSnapshot: (snapshot: PersistedSnapshot) => Promise<void> = async (snapshot) => {
    saved.push(structuredClone(snapshot))
  }
  try {
    storage.saveSnapshot = async (snapshot) => saveSnapshot(snapshot)
    setPreFlushCallback(async () => {
      if (!await flushNoteDraftsToStore()) throw new Error('测试草稿尚未完成')
    })
    seed()
    enablePersistWrites()
    root.render(<Harness />)
    await waitFor(() => document.querySelector('[data-stage-ownership-repair-view]') !== null, '阶段待整理页面没有渲染')

    const view = document.querySelector<HTMLElement>('[data-stage-ownership-repair-view]')!
    assert(view.textContent?.includes('阶段待整理'), '页面缺少明确标题')
    assert(view.textContent?.includes('待整理数据不会进入当前、历史阶段或绩效统计'), '页面没有解释可见性与统计影响')
    assert(!view.textContent?.includes('推荐阶段'), '页面不得根据日期推荐阶段')
    const healthLink = document.querySelector<HTMLAnchorElement>('[data-stage-ownership-health-entry]')
    assert(healthLink?.getAttribute('href') === '/settings/data/stage-ownership-repair', '数据健康入口链接错误')
    assert(healthLink.textContent?.includes('阶段待整理') && healthLink.textContent.includes('8'), '数据健康入口必须显示精确待整理数量')

    const labels = ['实盘交易', '错过机会', '案例', '周复盘', '周风险准备', '风险政策版本', '月度风险限额', '风险覆盖记录']
    for (const label of labels) assert(view.textContent?.includes(label), `页面缺少实体类型：${label}`)
    assert(row('case').textContent?.includes('来源交易') && row('case').textContent?.includes('TRD-source'), '案例没有显示原始来源关系')
    assert(row('review').textContent?.includes('2026-06-08') && row('limit').textContent?.includes('2026-06'), '页面缺少原始周/月上下文')
    assert(row('override').textContent?.includes('2026-06-17'), '风险覆盖缺少原始决策日期')

    for (const select of view.querySelectorAll<HTMLSelectElement>('select')) {
      assert(select.value === '', '目标阶段不得有默认或预选值')
      assert(select.getAttribute('aria-label')?.includes('选择目标阶段'), '目标阶段选择框缺少可访问标签')
      const options = [...select.options].map((option) => option.textContent ?? '')
      assert(options.some((option) => option.includes('当前执行期') && option.includes('当前阶段')), '选择框缺少当前阶段名称与状态')
      assert(options.some((option) => option.includes('历史训练期') && option.includes('历史阶段')), '选择框缺少历史阶段名称与状态')
    }
    assert(saveButton('live').disabled, '未显式选择阶段时不得保存')

    const gate: { release: (() => void) | null } = { release: null }
    let successAttempts = 0
    saveSnapshot = async (snapshot) => {
      successAttempts += 1
      saved.push(structuredClone(snapshot))
      if (successAttempts === 1) return
      await new Promise<void>((resolve) => { gate.release = resolve })
    }
    selectStage('live', 'stage-old')
    saveButton('live').click()
    await waitFor(() => successAttempts === 2 && saveButton('live').getAttribute('aria-busy') === 'true', '耐久保存期间必须显示 busy')
    assert(saveButton('live').disabled, '耐久保存期间必须禁用重复提交')
    gate.release?.()
    await waitFor(() => document.querySelector('[data-stage-ownership-id="live"]') === null, '成功保存后项目没有立即离开队列')
    assert(document.querySelector('[data-stage-ownership-page-status]')?.textContent?.includes('阶段归属已保存'), '成功保存后缺少可访问状态反馈')
    const savedLive = saved.at(-1)?.trades.find((item) => item.id === 'live')
    assert(savedLive?.tradeKind === 'live' && savedLive.liveStageId === 'stage-old', '正常持久化快照没有写入显式选择的阶段')
    assert(healthLink.textContent?.includes('7'), '成功修复后数据健康计数没有立即更新')

    setNoteDraft('source', '<p>保存前尚未冲洗的草稿</p>')
    let failureAttempts = 0
    saveSnapshot = async (snapshot) => {
      failureAttempts += 1
      if (failureAttempts === 2) throw new Error('repair persistence failure')
      saved.push(structuredClone(snapshot))
    }
    selectStage('missed', 'stage-current')
    saveButton('missed').click()
    await waitFor(() => failureAttempts === 3, '保存失败前没有先冲洗草稿，或失败后没有耐久写入回滚快照')
    await waitFor(() => row('missed').textContent?.includes('保存失败'), '保存失败没有显示可重试反馈')
    const rolledBackMissed = useStore.getState().trades.find((item) => item.id === 'missed')
    const draftCarrier = useStore.getState().trades.find((item) => item.id === 'source')
    const savedRollback = saved.at(-1)?.trades.find((item) => item.id === 'missed')
    const savedDraftCarrier = saved.at(-1)?.trades.find((item) => item.id === 'source')
    assert(rolledBackMissed?.tradeKind === 'live' && rolledBackMissed.liveStageId === null, '保存失败后 Store 没有恢复待整理状态')
    assert(savedRollback?.tradeKind === 'live' && savedRollback.liveStageId === null, '保存失败后的耐久回滚快照不正确')
    assert(draftCarrier?.note.includes('保存前尚未冲洗的草稿'), `失败回滚丢失了 pre-flush 写入 Store 的交易草稿：${JSON.stringify(draftCarrier?.note)}`)
    assert(savedDraftCarrier?.note.includes('保存前尚未冲洗的草稿'), '耐久回滚快照丢失了已冲洗交易草稿')
    assert(!hasNoteDraft('source'), '成功 pre-flush 后草稿应由 Store 接管')
    saveSnapshot = async (snapshot) => { saved.push(structuredClone(snapshot)) }
    saveButton('missed').click()
    await waitFor(() => document.querySelector('[data-stage-ownership-id="missed"]') === null, '保存失败后的重试没有成功')

    let conflictAttempts = 0
    saveSnapshot = async (snapshot) => {
      conflictAttempts += 1
      if (conflictAttempts === 2) throw new StorageRevisionConflictError(7, 8)
      saved.push(structuredClone(snapshot))
    }
    selectStage('case', 'stage-old')
    saveButton('case').click()
    await waitFor(() => conflictAttempts === 3, 'typed conflict 后没有持久化回滚')
    await waitFor(() => row('case').textContent?.includes('保存冲突'), 'typed conflict 没有显示冲突反馈')
    const rolledBackCase = useStore.getState().trades.find((item) => item.id === 'case')
    assert(rolledBackCase?.tradeKind === 'case' && rolledBackCase.liveStageId === null, '冲突后 Store 不得声称修复成功')
    saveSnapshot = async (snapshot) => { saved.push(structuredClone(snapshot)) }
    saveButton('case').click()
    await waitFor(() => document.querySelector('[data-stage-ownership-id="case"]') === null, '冲突后的显式重试没有成功')

    selectStage('review', 'stage-current')
    useStore.setState((state) => ({
      weeklyReviews: state.weeklyReviews.map((item) => item.id === 'review' ? { ...item, contentHtml: '<p>并发更新</p>' } : item),
    }))
    saveButton('review').click()
    await waitFor(() => row('review').textContent?.includes('发生变化'), 'stale item 没有要求刷新上下文')
    assert(useStore.getState().weeklyReviews[0]?.liveStageId === null, 'stale item 不得部分写入归属')

    selectStage('preparation', 'stage-old')
    useStore.setState((state) => ({ liveStages: state.liveStages.filter((stage) => stage.id !== 'stage-old') }))
    saveButton('preparation').click()
    await waitFor(() => row('preparation').textContent?.includes('目标阶段已不存在'), 'stale target 没有明确拒绝')
    assert(useStore.getState().weeklyRiskPreparations[0]?.liveStageId === null, 'stale target 不得部分写入归属')
    useStore.setState({ liveStages: [{
      id: 'stage-old', sequence: 1, name: '历史训练期', status: 'archived', startsOn: '2026-06-01', endsOn: '2026-06-30',
      createdAt: '2026-06-01T00:00:00.000Z', archivedAt: '2026-07-01T00:00:00.000Z',
    }, ...useStore.getState().liveStages.filter((stage) => stage.id !== 'stage-old')] })

    useStore.setState((state) => ({
      weeklyReviews: state.weeklyReviews.map((item) => ({ ...item, liveStageId: 'stage-current' })),
      weeklyRiskPreparations: state.weeklyRiskPreparations.map((item) => ({ ...item, liveStageId: 'stage-current' })),
      riskPolicyVersions: state.riskPolicyVersions.map((item) => ({ ...item, liveStageId: 'stage-current' })),
      monthlyRiskLimits: state.monthlyRiskLimits.map((item) => ({ ...item, liveStageId: 'stage-current' })),
      riskOverrideEvents: state.riskOverrideEvents.map((item) => ({ ...item, liveStageId: 'stage-current' })),
    }))
    await waitFor(() => document.querySelector('[data-stage-ownership-empty]') !== null, '全部完成后没有显示空状态')
    assert(view.textContent?.includes('所有迁移数据都已完成阶段归属'), '空状态没有解释所有迁移数据已分配')
    assert(document.documentElement.scrollWidth <= document.documentElement.clientWidth, '桌面宽度产生横向溢出')
  } finally {
    root.unmount()
    setPreFlushCallback(null)
    resetNoteDraftsForTests()
    storage.saveSnapshot = originalSaveSnapshot
    disablePersistWrites()
    useSaveStatus.getState().reset()
    useStore.setState(previous, true)
  }
}

window.__stageOwnershipRepairViewBrowserTest = run()

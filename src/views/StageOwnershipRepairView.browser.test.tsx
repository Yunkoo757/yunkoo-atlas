import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { activeRiskPolicy } from '@/lib/activeRiskPolicy'
import { applySnapshotToStore } from '@/lib/importExport'
import { matchesStageScope } from '@/lib/stageArchive'
import { forLiveStage, riskSetupStateForStage } from '@/lib/stageRisk'
import { getTradingDayKey } from '@/lib/periods'
import { StageOwnershipRepairView } from '@/views/StageOwnershipRepairView'
import { StageOwnershipHealthEntry } from '@/views/settings/DataSettingsPanel'
import { StorageRevisionConflictError } from '@/storage/adapter'
import { disablePersistWrites, enablePersistWrites, hasPendingChanges, setPreFlushCallback } from '@/storage/persist'
import { getStorage } from '@/storage/provider'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import type { PersistedSnapshot } from '@/storage/types'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import { useStore } from '@/store/useStore'
import { useSaveStatus } from '@/store/saveStatus'
import {
  flushNoteDraftsToStore,
  flushNoteDraftToStore,
  hasNoteDraft,
  resetNoteDraftsForTests,
  setNoteDraft,
  WEEKLY_REVIEW_DRAFT_PREFIX,
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
  'Persist failed Error: rollback persistence failure',
  'Persist failed StorageRevisionConflictError',
]

const PREPARATION_ID = 'weekly-risk-preparation:null:2026-06-08'

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

function plannedTrade(id: string, openedAt: string): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: 'strategy-contract',
    tradeKind: 'live',
    liveStageId: 'stage-current',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 0,
    exit: null,
    size: 0,
    pnl: null,
    rMultiple: null,
    openedAt,
    closedAt: null,
    note: '',
  }
}

function seed(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const currentTradingDayKey = getTradingDayKey(new Date(), 0)
  const currentMonthKey = currentTradingDayKey.slice(0, 7)
  const currentInstant = new Date().toISOString()
  const source = trade('source', { liveStageId: 'stage-current' })
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
      plannedTrade('risk-gate-target', currentTradingDayKey),
    ],
    weeklyReviews: [{
      ...fixture.weeklyReviews![0]!,
      id: 'review',
      liveStageId: null,
      weekStart: '2026-06-08',
      weekEnd: '2026-06-14',
      highlightTradeIds: [],
      mistakeTradeIds: [],
      followUpTradeIds: [],
      riskSnapshot: undefined,
    }, {
      ...fixture.weeklyReviews![0]!,
      id: 'invalid-review',
      liveStageId: null,
      weekStart: '2026-02-30',
      weekEnd: '2026-03-08',
      legacyPeriodQuarantine: true,
      highlightTradeIds: [],
      mistakeTradeIds: [],
      followUpTradeIds: [],
      riskSnapshot: undefined,
    }],
    weeklyRiskPreparations: [{
      ...fixture.weeklyRiskPreparations[0]!,
      id: PREPARATION_ID,
      liveStageId: null,
      weekStart: '2026-06-08',
      confirmedPolicyVersionId: 'policy',
    }],
    riskPolicyVersions: [{
      ...fixture.riskPolicyVersions[0]!,
      id: 'policy',
      liveStageId: null,
      sourceWeekStart: currentTradingDayKey,
      effectiveTradingDay: currentTradingDayKey,
      confirmedAt: currentInstant,
    }],
    monthlyRiskLimits: [{
      ...fixture.monthlyRiskLimits[0]!,
      id: `monthly-risk-limit:null:${currentMonthKey}`,
      liveStageId: null,
      monthKey: currentMonthKey,
      sourcePolicyVersionId: 'policy',
      lockedAt: currentInstant,
    }],
    riskOverrideEvents: [{
      ...fixture.riskOverrideEvents[0]!,
      id: 'override',
      liveStageId: null,
      tradeId: source.id,
      policyVersionId: 'policy',
      tradingDayKeyAtDecision: currentTradingDayKey,
    }],
    display: { ...fixture.display, tradingDayStartHour: 0 },
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

function setDate(entityId: string, field: 'weekStart' | 'weekEnd', value: string): void {
  const input = row(entityId).querySelector<HTMLInputElement>(`input[data-weekly-period-${field}]`)
  assert(input, `${entityId} 缺少 ${field} 显式日期修复输入`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const saved: PersistedSnapshot[] = []
  const currentTradingDayKey = getTradingDayKey(new Date(), 0)
  const repairedLimitId = `monthly-risk-limit:null:${currentTradingDayKey.slice(0, 7)}`
  window.localStorage.removeItem('trader-atlas:stage-ownership-drafts:v1')
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
    assert(view.textContent?.includes('待归属记录'), '页面缺少明确标题')
    assert(view.textContent?.includes('选择会自动记住'), '页面没有解释选择记忆行为')
    assert(!view.textContent?.includes('推荐阶段'), '页面不得根据日期推荐阶段')
    const healthLink = document.querySelector<HTMLAnchorElement>('[data-stage-ownership-health-entry]')
    assert(healthLink?.getAttribute('href') === '/settings/data/stage-ownership-repair', '数据健康入口链接错误')
    assert(healthLink.textContent?.includes('待归属记录') && healthLink.textContent.includes('9'), '数据健康入口必须显示精确待整理数量')

    const labels = ['实盘交易', '错过机会', '案例', '周复盘', '周风险准备', '风险政策版本', '月度风险限额', '风险覆盖记录']
    for (const label of labels) assert(view.textContent?.includes(label), `页面缺少实体类型：${label}`)
    assert(row('case').textContent?.includes('来源交易') && row('case').textContent?.includes('TRD-source'), '案例没有显示原始来源关系')
    assert(row('review').textContent?.includes('2026-06-08') && row(repairedLimitId).textContent?.includes(currentTradingDayKey.slice(0, 7)), '页面缺少原始周/月上下文')
    assert(row('override').textContent?.includes(currentTradingDayKey), '风险覆盖缺少原始决策日期')

    for (const select of view.querySelectorAll<HTMLSelectElement>('select')) {
      assert(select.value === '', '目标阶段不得有默认或预选值')
      assert(select.getAttribute('aria-label')?.includes('选择目标阶段'), '目标阶段选择框缺少可访问标签')
      const options = [...select.options].map((option) => option.textContent ?? '')
      assert(options.some((option) => option.includes('当前执行期') && option.includes('当前')), '选择框缺少当前阶段名称与状态')
      assert(options.some((option) => option.includes('历史训练期')), '选择框缺少历史阶段名称')
    }
    assert(saveButton('live').disabled, '未显式选择阶段时不得保存')

    const invalidReviewRow = row('invalid-review')
    assert(invalidReviewRow.textContent?.includes('原始周区间无效') && invalidReviewRow.textContent.includes('修正'), '非法周复盘没有可发现的日期修复说明')
    selectStage('invalid-review', 'stage-old')
    assert(
      window.localStorage.getItem('trader-atlas:stage-ownership-drafts:v1')?.includes('stage-old'),
      '阶段选择必须立即写入重启可恢复的草稿',
    )
    assert(saveButton('invalid-review').disabled, '隔离周复盘未显式修正日期时不得保存')
    setDate('invalid-review', 'weekStart', '2026-06-22')
    setDate('invalid-review', 'weekEnd', '2026-06-28')
    assert(!saveButton('invalid-review').disabled, '填写有效周区间并选择阶段后应允许保存')

    let invalidRepairAttempts = 0
    saveSnapshot = async (snapshot) => {
      invalidRepairAttempts += 1
      saved.push(structuredClone(snapshot))
      if (invalidRepairAttempts === 2) throw new Error('repair persistence failure')
    }
    saveButton('invalid-review').click()
    await waitFor(() => invalidRepairAttempts === 3, '非法周区间修复失败后没有持久化精确回滚')
    await waitFor(() => row('invalid-review').textContent?.includes('保存失败'), '非法周区间修复失败没有显示可重试反馈')
    const restoredInvalidReview = useStore.getState().weeklyReviews.find((item) => item.id === 'invalid-review')
    assert(
      restoredInvalidReview?.liveStageId === null &&
        restoredInvalidReview.weekStart === '2026-02-30' &&
        restoredInvalidReview.weekEnd === '2026-03-08' &&
        restoredInvalidReview.legacyPeriodQuarantine === true,
      '非法周区间保存失败后 Store 没有恢复原始日期与隔离标记',
    )
    saveSnapshot = async (snapshot) => { saved.push(structuredClone(snapshot)) }
    saveButton('invalid-review').click()
    await waitFor(() => document.querySelector('[data-stage-ownership-id="invalid-review"]') === null, '非法周区间修复重试没有成功')
    assert(
      !window.localStorage.getItem('trader-atlas:stage-ownership-drafts:v1')?.includes('invalid-review'),
      '归属保存成功后必须清理对应草稿',
    )
    const durableInvalidReview = saved.at(-1)?.weeklyReviews?.find((item) => item.id === 'invalid-review')
    assert(
      durableInvalidReview?.liveStageId === 'stage-old' &&
        durableInvalidReview.weekStart === '2026-06-22' &&
        durableInvalidReview.weekEnd === '2026-06-28' &&
        !Object.prototype.hasOwnProperty.call(durableInvalidReview, 'legacyPeriodQuarantine'),
      '耐久快照没有写入显式修正后的规范周区间',
    )

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

    const failureGate: { release: (() => void) | null } = { release: null }
    let failureAttempts = 0
    saveSnapshot = async (snapshot) => {
      failureAttempts += 1
      saved.push(structuredClone(snapshot))
      if (failureAttempts === 2) {
        await new Promise<void>((resolve) => { failureGate.release = resolve })
        throw new Error('repair persistence failure')
      }
    }
    selectStage('missed', 'stage-current')
    saveButton('missed').click()
    await waitFor(() => failureAttempts === 2 && failureGate.release !== null, '没有进入第二次归属耐久保存')
    setNoteDraft('source', '<p>第二次保存期间并发交易草稿</p>')
    setNoteDraft(`${WEEKLY_REVIEW_DRAFT_PREFIX}review`, '<p>第二次保存期间并发周复盘草稿</p>')
    assert(await flushNoteDraftToStore('source'), '并发交易草稿没有写入 Store')
    assert(await flushNoteDraftToStore(`${WEEKLY_REVIEW_DRAFT_PREFIX}review`), '并发周复盘草稿没有写入 Store')
    useStore.setState((state) => ({
      trades: state.trades.map((item) => item.id === 'missed' ? { ...item, note: '<p>并发更新目标实体正文</p>' } : item),
    }))
    failureGate.release?.()
    await waitFor(() => failureAttempts === 3, '保存失败前没有先冲洗草稿，或失败后没有耐久写入回滚快照')
    await waitFor(() => row('missed').textContent?.includes('保存失败'), '保存失败没有显示可重试反馈')
    const rolledBackMissed = useStore.getState().trades.find((item) => item.id === 'missed')
    const draftCarrier = useStore.getState().trades.find((item) => item.id === 'source')
    const savedRollback = saved.at(-1)?.trades.find((item) => item.id === 'missed')
    const savedDraftCarrier = saved.at(-1)?.trades.find((item) => item.id === 'source')
    assert(rolledBackMissed?.tradeKind === 'live' && rolledBackMissed.liveStageId === null, '保存失败后 Store 没有恢复待整理状态')
    assert(savedRollback?.tradeKind === 'live' && savedRollback.liveStageId === null, '保存失败后的耐久回滚快照不正确')
    const concurrentReview = useStore.getState().weeklyReviews.find((item) => item.id === 'review')
    const savedConcurrentReview = saved.at(-1)?.weeklyReviews?.find((item) => item.id === 'review')
    assert(rolledBackMissed?.note.includes('目标实体正文'), '失败回滚覆盖了目标实体在第二次保存期间发生的其他字段更新')
    assert(draftCarrier?.note.includes('第二次保存期间并发交易草稿'), `失败回滚丢失了第二次保存期间写入 Store 的交易草稿：${JSON.stringify(draftCarrier?.note)}`)
    assert(savedDraftCarrier?.note.includes('第二次保存期间并发交易草稿'), '耐久回滚快照丢失了并发交易草稿')
    assert(concurrentReview?.contentHtml.includes('并发周复盘草稿'), '失败回滚丢失了并发周复盘草稿')
    assert(savedConcurrentReview?.contentHtml.includes('并发周复盘草稿'), '耐久回滚快照丢失了并发周复盘草稿')
    assert(!hasNoteDraft('source'), '成功 pre-flush 后草稿应由 Store 接管')
    assert(!hasPendingChanges() && useSaveStatus.getState().status === 'saved', '耐久回滚完成后必须是磁盘与 Store 对齐的 saved/clean 状态')
    saveSnapshot = async (snapshot) => { saved.push(structuredClone(snapshot)) }
    saveButton('missed').click()
    await waitFor(() => document.querySelector('[data-stage-ownership-id="missed"]') === null, '保存失败后的重试没有成功')

    let conflictAttempts = 0
    saveSnapshot = async (snapshot) => {
      conflictAttempts += 1
      if (conflictAttempts === 2) throw new StorageRevisionConflictError(7, 8)
      saved.push(structuredClone(snapshot))
    }
    selectStage('case', 'stage-current')
    saveButton('case').click()
    await waitFor(() => conflictAttempts === 3, 'typed conflict 后没有持久化回滚')
    await waitFor(() => row('case').textContent?.includes('保存冲突'), 'typed conflict 没有显示冲突反馈')
    const rolledBackCase = useStore.getState().trades.find((item) => item.id === 'case')
    const durableRolledBackCase = saved.at(-1)?.trades.find((item) => item.id === 'case')
    assert(rolledBackCase?.tradeKind === 'case' && rolledBackCase.liveStageId === null, '冲突后 Store 不得声称修复成功')
    assert(durableRolledBackCase?.tradeKind === 'case' && durableRolledBackCase.liveStageId === null, '冲突后的磁盘快照必须恢复待整理归属')
    assert(useSaveStatus.getState().status === 'saved' && !hasPendingChanges(), '冲突耐久回滚完成后必须是 saved/clean')
    saveSnapshot = async (snapshot) => { saved.push(structuredClone(snapshot)) }
    saveButton('case').click()
    await waitFor(() => document.querySelector('[data-stage-ownership-id="case"]') === null, '冲突后的显式重试没有成功')

    selectStage('review', 'stage-old')
    useStore.setState((state) => ({
      weeklyReviews: state.weeklyReviews.map((item) => item.id === 'review' ? { ...item, contentHtml: '<p>并发更新</p>' } : item),
    }))
    saveButton('review').click()
    await waitFor(() => row('review').textContent?.includes('发生变化'), 'stale item 没有要求刷新上下文')
    assert(useStore.getState().weeklyReviews.find((item) => item.id === 'review')?.liveStageId === null, 'stale item 不得部分写入归属')

    let rollbackFailureAttempts = 0
    saveSnapshot = async (snapshot) => {
      rollbackFailureAttempts += 1
      if (rollbackFailureAttempts === 2 || rollbackFailureAttempts === 3) {
        throw new Error('rollback persistence failure')
      }
      saved.push(structuredClone(snapshot))
    }
    saveButton('review').click()
    await waitFor(() => rollbackFailureAttempts === 3, '没有覆盖归属保存失败后的回滚保存失败')
    await waitFor(() => row('review').textContent?.includes('回滚均失败'), '回滚保存失败没有显示资料库恢复指引')
    assert(useStore.getState().weeklyReviews.find((item) => item.id === 'review')?.liveStageId === null, '回滚保存失败后 Store 必须保持待整理归属')
    assert(useSaveStatus.getState().status === 'error' && hasPendingChanges(), '回滚保存失败后必须保持 error/dirty 供重试')
    const durableBeforeRollbackRetry = saved.at(-1)?.weeklyReviews?.find((item) => item.id === 'review')
    assert(durableBeforeRollbackRetry?.liveStageId === null, '回滚保存失败时最后成功磁盘快照不得声称已完成归属')
    saveSnapshot = async (snapshot) => { saved.push(structuredClone(snapshot)) }
    saveButton('review').click()
    await waitFor(() => document.querySelector('[data-stage-ownership-id="review"]') === null, '回滚保存失败后的显式重试没有成功')
    assert(!hasPendingChanges() && useSaveStatus.getState().status === 'saved', '重试完成后必须恢复 saved/clean')

    selectStage(PREPARATION_ID, 'stage-old')
    useStore.setState((state) => ({ liveStages: state.liveStages.filter((stage) => stage.id !== 'stage-old') }))
    saveButton(PREPARATION_ID).click()
    await waitFor(() => row(PREPARATION_ID).textContent?.includes('目标阶段已不存在'), 'stale target 没有明确拒绝')
    assert(useStore.getState().weeklyRiskPreparations[0]?.liveStageId === null, 'stale target 不得部分写入归属')
    useStore.setState({ liveStages: [{
      id: 'stage-old', sequence: 1, name: '历史训练期', status: 'archived', startsOn: '2026-06-01', endsOn: '2026-06-30',
      createdAt: '2026-06-01T00:00:00.000Z', archivedAt: '2026-07-01T00:00:00.000Z',
    }, ...useStore.getState().liveStages.filter((stage) => stage.id !== 'stage-old')] })

    const rollbackConflictGate: { release: (() => void) | null } = { release: null }
    let rollbackConflictAttempts = 0
    saveSnapshot = async (snapshot) => {
      rollbackConflictAttempts += 1
      if (rollbackConflictAttempts === 2) {
        await new Promise<void>((resolve) => { rollbackConflictGate.release = resolve })
        throw new Error('repair persistence failure')
      }
      saved.push(structuredClone(snapshot))
    }
    selectStage('policy', 'stage-current')
    saveButton('policy').click()
    await waitFor(() => rollbackConflictAttempts === 2 && rollbackConflictGate.release !== null, '没有进入用于 CAS 冲突的第二次保存')
    useStore.setState((state) => ({
      riskPolicyVersions: state.riskPolicyVersions.map((item) => item.id === 'policy'
        ? { ...item, liveStageId: 'stage-old', disciplineText: '第二次保存期间并发修改政策' }
        : item),
    }))
    rollbackConflictGate.release?.()
    await waitFor(() => Boolean(document.querySelector('[data-stage-ownership-page-status]')?.textContent?.includes('未覆盖最新资料')), 'CAS 回滚冲突没有在页面级提示恢复指引')
    const concurrentPolicy = useStore.getState().riskPolicyVersions.find((item) => item.id === 'policy')
    assert(Boolean(concurrentPolicy?.liveStageId === 'stage-old' && concurrentPolicy.disciplineText.includes('并发修改')), 'CAS 回滚不得覆盖并发归属或目标其他字段')
    assert(useSaveStatus.getState().status === 'error' && hasPendingChanges(), 'CAS 回滚冲突必须保持 error/dirty 供用户恢复')
    useStore.setState((state) => ({
      riskPolicyVersions: state.riskPolicyVersions.map((item) => item.id === 'policy' ? { ...item, liveStageId: null } : item),
    }))
    await waitFor(() => document.querySelector('[data-stage-ownership-id="policy"]') !== null, '恢复待整理归属后政策没有回到队列')
    saveSnapshot = async (snapshot) => { saved.push(structuredClone(snapshot)) }

    async function repairThroughUi(entityId: string, snapshotOwnsEntity: (snapshot: PersistedSnapshot) => boolean): Promise<void> {
      selectStage(entityId, 'stage-current')
      saveButton(entityId).click()
      await waitFor(() => document.querySelector(`[data-stage-ownership-id="${entityId}"]`) === null, `${entityId} 没有通过真实 UI 完成归属`)
      const durable = saved.at(-1)
      assert(durable, `${entityId} 没有生成耐久快照`)
      assertValidPersistedSnapshot(durable, `${entityId} 阶段归属耐久快照`)
      assert(snapshotOwnsEntity(durable), `${entityId} 的耐久快照没有写入显式目标阶段`)
    }

    await repairThroughUi('policy', (snapshot) => snapshot.riskPolicyVersions.some((item) => item.id === 'policy' && item.liveStageId === 'stage-current'))
    await repairThroughUi(PREPARATION_ID, (snapshot) => snapshot.weeklyRiskPreparations.some((item) => item.id === PREPARATION_ID && item.liveStageId === 'stage-current'))
    await repairThroughUi(repairedLimitId, (snapshot) => snapshot.monthlyRiskLimits.some((item) => item.id === repairedLimitId && item.liveStageId === 'stage-current'))
    await repairThroughUi('override', (snapshot) => snapshot.riskOverrideEvents.some((item) => item.id === 'override' && item.liveStageId === 'stage-current'))

    const durable = saved.at(-1)
    assert(durable, '完整修复没有最终耐久快照')
    assertValidPersistedSnapshot(durable, '完整阶段归属修复快照')
    disablePersistWrites()
    applySnapshotToStore(structuredClone(durable))
    const reloaded = useStore.getState()
    assert(reloaded.weeklyReviews.some((item) => item.id === 'review' && matchesStageScope(item, { kind: 'stage', stageId: 'stage-old' })), '重载后周复盘归档消费者没有读到修复归属')
    assert(forLiveStage(reloaded.weeklyRiskPreparations, 'stage-current').some((item) => item.id === PREPARATION_ID), '重载后周风险准备消费者没有读到修复归属')
    assert(activeRiskPolicy(reloaded.riskPolicyVersions, currentTradingDayKey, 'stage-current')?.id === 'policy', '重载后活动风险政策消费者没有读到修复版本')
    assert(forLiveStage(reloaded.monthlyRiskLimits, 'stage-current').some((item) => item.id === repairedLimitId), '重载后月度风险限额消费者没有读到修复归属')
    assert(forLiveStage(reloaded.riskOverrideEvents, 'stage-current').some((item) => item.id === 'override'), '重载后风险覆盖消费者没有读到修复归属')
    assert(riskSetupStateForStage(reloaded, 'stage-current', currentTradingDayKey) === 'configured', 'null 前缀月限额修复并重载后必须完成风险建档')
    const openResult = useStore.getState().requestTradeOpen('risk-gate-target')
    assert(openResult === 'opened' || openResult === 'pending-confirmation', '修复并重载后的风险建档必须允许开仓或进入正常风险确认')

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

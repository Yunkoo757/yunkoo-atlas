import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { createWeeklyReview } from '@/data/weeklyReviews'
import type { Trade } from '@/data/trades'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { useToast } from '@/lib/toast'
import { collectAssetIdsFromSnapshot } from '@/storage/assets'
import { disablePersistWrites, enablePersistWrites } from '@/storage/persist'
import { getStorage } from '@/storage/provider'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __livePerformanceCycleManagerTest?: Promise<void>
    __atlasBrowserAllowedErrors?: string[]
  }
}

window.__atlasBrowserAllowedErrors = [
  'Persist failed Error: test cycle save failure',
  'Persist failed Error: test cycle rollback failure',
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

function addDays(dayKey: string, amount: number): string {
  const date = parseLocalDate(dayKey)
  date.setDate(date.getDate() + amount)
  return formatYmd(date)
}

function text(): string {
  return document.body.textContent ?? ''
}

function findButton(label: string, scope: ParentNode = document): HTMLButtonElement | null {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
    ?? null
}

function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const result = findButton(label, scope)
  assert(result, `找不到按钮：${label}`)
  return result
}

function click(label: string, scope: ParentNode = document): void {
  button(label, scope).click()
}

function setInput(ariaLabel: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${ariaLabel}"]`)
  assert(input, `找不到输入框：${ariaLabel}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  assert(setter, '浏览器缺少 input value setter')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function selectDate(ariaLabel: string, dayKey: string): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`)
  assert(trigger, `找不到日期选择器：${ariaLabel}`)
  trigger.click()
  await waitFor(
    () => Boolean(document.querySelector(`[role="gridcell"][aria-label="${dayKey}"]`)),
    `日历没有显示 ${dayKey}`,
  )
  document.querySelector<HTMLButtonElement>(`[role="gridcell"][aria-label="${dayKey}"]`)?.click()
}

function validationReason(): string {
  return document.querySelector<HTMLElement>('[data-cycle-validation]')?.textContent?.trim() ?? ''
}

function closedLive(
  id: string,
  pnl: number,
  openedAt: string,
  closedTradingDayKey: string,
  patch: Partial<Trade> = {},
): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt,
    closedAt: closedTradingDayKey,
    closedTradingDayKey,
    note: '',
    ...patch,
  }
}

async function openManager(): Promise<void> {
  const trigger = button(useStore.getState().livePerformanceCycles.length === 0 ? '开始新统计周期' : '管理周期')
  trigger.focus()
  trigger.click()
  await waitFor(() => Boolean(document.querySelector('[data-cycle-manager]')), '统计周期管理弹窗未打开')
}

async function closeManager(): Promise<void> {
  const close = document.querySelector<HTMLButtonElement>('.modal-shell-close')
  assert(close, '统计周期管理弹窗缺少关闭按钮')
  close.click()
  await waitFor(() => !document.querySelector('[data-cycle-manager]'), '统计周期管理弹窗未关闭')
}

function compatibilitySnapshot(): string {
  const state = useStore.getState()
  const caseOwnedFields = state.trades
    .filter((trade) => trade.tradeKind === 'case')
    .map((trade) => ({
      id: trade.id,
      sourceTradeId: trade.sourceTradeId,
      sourceNoteHtml: trade.sourceNoteHtml,
      note: trade.note,
      caseType: trade.caseType,
      masteryState: trade.masteryState,
      nextReviewAt: trade.nextReviewAt,
      recordedAt: trade.recordedAt,
    }))
  const assetReferences = collectAssetIdsFromSnapshot({
    trades: state.trades,
    weeklyReviews: state.weeklyReviews,
    quickNotes: state.quickNotes,
  }).sort()
  return JSON.stringify({
    trades: state.trades,
    caseOwnedFields,
    weeklyReviews: state.weeklyReviews,
    liveStatsStartTradingDayKey: state.liveStatsStartTradingDayKey,
    assetReferences,
  })
}

function assertCompatibilityUnchanged(expected: string, context: string): void {
  assert(
    compatibilitySnapshot() === expected,
    `${context}不得改写交易、案例字段、周复盘快照、风险核算起点或资源引用`,
  )
}

function assertMobileDialogReachable(): void {
  assert(
    document.documentElement.scrollWidth <= window.innerWidth,
    `统计周期弹窗不得横向溢出：${document.documentElement.scrollWidth} > ${window.innerWidth}`,
  )
  for (const label of ['取消', '确认开始']) {
    const target = button(label)
    const rect = target.getBoundingClientRect()
    assert(
      rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight,
      `${label}按钮必须在 ${window.innerWidth}×${window.innerHeight} 视口内可达`,
    )
  }
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const tradingDayStartHour = previous.display.tradingDayStartHour
  const currentDay = getTradingDayKey(new Date(), tradingDayStartHour)
  const firstStart = addDays(currentDay, -6)
  const secondStart = addDays(currentDay, -2)
  const beforeFirst = addDays(firstStart, -1)
  const crossOpened = addDays(firstStart, -3)
  const fixtureTrades = [
    closedLive('before-first', 10, beforeFirst, beforeFirst),
    closedLive('cross-boundary', 20, crossOpened, firstStart),
    closedLive('after-first', 30, addDays(firstStart, 1), addDays(firstStart, 1)),
    closedLive('copied-case', 999, beforeFirst, beforeFirst, {
      tradeKind: 'case',
      sourceTradeId: 'before-first',
      sourceNoteHtml: '<p>来源快照</p><img src="journal-asset://source-snapshot-asset">',
      caseType: 'exemplar',
      masteryState: 'recheck',
      recordedAt: currentDay,
      note: '<p>案例自己的结论</p><img src="journal-asset://case-owned-asset">',
    }),
  ]
  const weeklyReview = {
    ...createWeeklyReview(firstStart, new Date(`${firstStart}T12:00:00.000Z`)),
    status: 'completed' as const,
    contentHtml: '<p>冻结周复盘</p><img src="journal-asset://weekly-review-asset">',
    completedAt: `${firstStart}T12:00:00.000Z`,
  }
  const router = createMemoryRouter([
    { path: '/dashboard', element: <Dashboard /> },
  ], { initialEntries: ['/dashboard?kind=live&range=this-week'] })
  const root = createRoot(rootElement)

  try {
    disablePersistWrites()
    useStore.setState({
      trades: fixtureTrades,
      weeklyReviews: [weeklyReview],
      strategies: [{ id: 'strategy-1', name: '测试策略', icon: 'target', color: '#5e6ad2' }],
      livePerformanceCycles: [],
      liveStatsStartTradingDayKey: addDays(firstStart, -20),
    })
    const immutableCompatibility = compatibilitySnapshot()
    root.render(<RouterProvider router={router} />)

    await waitFor(() => text().includes('开始新统计周期'), '空库没有显示创建入口')
    const initialTrigger = button('开始新统计周期')
    await openManager()
    await waitFor(
      () => document.activeElement === document.querySelector('input[aria-label="统计周期名称"]'),
      '首次创建弹窗必须把焦点送入首个无效主字段',
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => !document.querySelector('[data-cycle-manager]'), 'idle 状态按 Escape 必须关闭弹窗')
    await waitFor(
      () => document.activeElement === initialTrigger,
      'idle Escape 关闭后必须把焦点返回原触发器',
    )
    await openManager()
    await waitFor(
      () => document.activeElement === document.querySelector('input[aria-label="统计周期名称"]'),
      '重新打开创建弹窗必须聚焦名称主字段',
    )
    assertMobileDialogReachable()
    assert(useStore.getState().livePerformanceCycles.length === 0, '打开弹窗不得提前生成周期')
    assert(validationReason() === '请输入统计周期名称', '空名称必须显示稳定原因')
    assert(button('确认开始').disabled, '空名称时确认必须禁用')
    setInput('统计周期名称', '第一期')
    await selectDate('统计周期开始日期', firstStart)
    await waitFor(
      () => text().includes('统计起点前实盘 1 笔') && text().includes('本周期实盘 2 笔'),
      '回溯第一期预览必须按平仓日计数并包含跨界交易',
    )
    assert(useStore.getState().livePerformanceCycles.length === 0, '填写草稿不得生成 ID 或 createdAt')

    let releaseSave: () => void = () => undefined
    let saveAttempts = 0
    storage.saveSnapshot = async () => {
      saveAttempts += 1
      await new Promise<void>((resolve) => { releaseSave = resolve })
    }
    enablePersistWrites()
    click('确认开始')
    await waitFor(() => saveAttempts === 1, '创建确认没有开始持久化')
    const busyConfirm = document.querySelector<HTMLButtonElement>('.modal-shell-footer .ui-btn-primary')
    assert(busyConfirm, 'busy 时确认按钮未保留')
    busyConfirm.click()
    await frame()
    assert(saveAttempts === 1, 'busy 时重复确认不得触发第二次保存')
    assert(busyConfirm.disabled, 'busy 时确认按钮必须禁用')
    assert(document.querySelector<HTMLButtonElement>('.modal-shell-close')?.disabled, 'busy 时关闭按钮必须禁用')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.querySelector<HTMLElement>('.modal-shell-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await frame()
    assert(Boolean(document.querySelector('[data-cycle-manager]')), 'busy 时 Escape 或遮罩不得关闭弹窗')
    assert(router.state.location.search.includes('range=this-week'), '持久化成功前不得切换 Dashboard 范围')
    assert(useStore.getState().livePerformanceCycles.length === 1, '确认时才应生成首个周期')
    const firstCreated = useStore.getState().livePerformanceCycles[0]
    assert(firstCreated?.id && firstCreated.createdAt, '确认创建必须同时生成 ID 与 createdAt')
    assertCompatibilityUnchanged(immutableCompatibility, '创建首个周期')
    releaseSave()
    await waitFor(() => !document.querySelector('[data-cycle-manager]'), '创建持久化成功后弹窗未关闭')
    await waitFor(() => router.state.location.search.includes('range=all'), '创建成功后没有导航到全部时间范围')
    assert(!router.state.location.search.includes('statsCycle='), '创建成功后必须导航到 canonical 当前周期')
    storage.saveSnapshot = originalSaveSnapshot
    disablePersistWrites()

    await openManager()
    await frame()
    await frame()
    click('开始下一统计周期')
    await waitFor(
      () => document.activeElement === document.querySelector('input[aria-label="统计周期名称"]'),
      '首页进入创建后必须聚焦名称输入',
    )
    click('取消')
    await waitFor(
      () => document.activeElement === findButton('开始下一统计周期'),
      '取消创建后必须恢复到开始下一统计周期按钮',
    )

    const focusRenameRow = document.querySelector<HTMLElement>(`[data-cycle-id="${firstCreated.id}"]`)
    assert(focusRenameRow, '焦点测试缺少第一期')
    click('重命名', focusRenameRow)
    await waitFor(
      () => document.activeElement === document.querySelector('input[aria-label="统计周期名称"]'),
      '首页进入重命名后必须聚焦名称输入',
    )
    click('取消')
    await waitFor(() => {
      const returnedRow = document.querySelector<HTMLElement>(`[data-cycle-id="${firstCreated.id}"]`)
      return returnedRow ? document.activeElement === findButton('重命名', returnedRow) : false
    }, '取消重命名后必须恢复到对应周期的重命名按钮')

    click('撤销最新周期')
    await waitFor(
      () => document.activeElement === findButton('确认撤销'),
      '首页进入撤销后必须聚焦确认撤销按钮',
    )
    click('取消')
    await waitFor(
      () => document.activeElement === findButton('撤销最新周期'),
      '取消撤销后必须恢复到撤销最新周期按钮',
    )

    click('开始下一统计周期')
    await waitFor(() => Boolean(document.querySelector('input[aria-label="统计周期名称"]')), '下一期表单未出现')
    setInput('统计周期名称', '一'.repeat(41))
    await waitFor(() => validationReason() === '统计周期名称不能超过 40 个字符', '超长名称原因不稳定')
    assert(button('确认开始').disabled, '超长名称时确认必须禁用')
    setInput('统计周期名称', '第一期')
    await waitFor(() => validationReason() === '统计周期名称已存在', '重复名称原因不稳定')
    assert(button('确认开始').disabled, '重复名称时确认必须禁用')
    setInput('统计周期名称', '第二期')
    await selectDate('统计周期开始日期', firstStart)
    await waitFor(
      () => validationReason() === '开始日期必须晚于当前统计周期的开始日期',
      '同日边界必须显示稳定原因',
    )
    assert(button('确认开始').disabled, '同日边界时确认必须禁用')
    await selectDate('统计周期开始日期', addDays(firstStart, -1))
    await waitFor(
      () => validationReason() === '开始日期必须晚于当前统计周期的开始日期',
      '早于当前开始日期必须显示稳定原因',
    )
    await selectDate('统计周期开始日期', addDays(currentDay, 1))
    await waitFor(() => validationReason() === '开始日期不能晚于当前交易日', '未来日期原因不稳定')
    assert(button('确认开始').disabled, '未来日期时确认必须禁用')
    await selectDate('统计周期开始日期', secondStart)
    await waitFor(
      () => text().includes(`上一统计周期将于 ${addDays(secondStart, -1)} 结束`),
      '下一期预览没有显示前一期结束日',
    )
    click('确认开始')
    await waitFor(() => useStore.getState().livePerformanceCycles.length === 2, '第二期未创建')
    await waitFor(() => !document.querySelector('[data-cycle-manager]'), '第二期创建成功后弹窗未关闭')
    assertCompatibilityUnchanged(immutableCompatibility, '创建下一统计周期')

    const recordsBeforeRename = {
      trades: JSON.stringify(useStore.getState().trades),
      cases: JSON.stringify(useStore.getState().trades.filter((trade) => trade.tradeKind === 'case')),
      weeklyReviews: JSON.stringify(useStore.getState().weeklyReviews),
      riskStart: useStore.getState().liveStatsStartTradingDayKey,
    }
    await openManager()
    const firstRow = document.querySelector<HTMLElement>(`[data-cycle-id="${firstCreated.id}"]`)
    assert(firstRow, '管理列表缺少第一期')
    click('重命名', firstRow)
    await waitFor(() => text().includes('重命名统计周期'), '重命名表单未出现')
    setInput('统计周期名称', '第二期')
    await waitFor(() => validationReason() === '统计周期名称已存在', '重命名重复名称原因不稳定')
    assert(button('确认重命名').disabled, '重命名重复名称时确认必须禁用')
    setInput('统计周期名称', '首期回溯')
    click('确认重命名')
    await waitFor(() => useStore.getState().livePerformanceCycles[0]?.name === '首期回溯', '重命名未生效')
    await waitFor(() => !document.querySelector('[data-cycle-manager]'), '重命名成功后弹窗未关闭')
    assert(JSON.stringify(useStore.getState().trades) === recordsBeforeRename.trades, '重命名不得改写交易')
    assert(
      JSON.stringify(useStore.getState().trades.filter((trade) => trade.tradeKind === 'case')) === recordsBeforeRename.cases,
      '重命名不得改写案例',
    )
    assert(JSON.stringify(useStore.getState().weeklyReviews) === recordsBeforeRename.weeklyReviews, '重命名不得改写周复盘')
    assert(useStore.getState().liveStatsStartTradingDayKey === recordsBeforeRename.riskStart, '重命名不得改写风险核算起点')
    assertCompatibilityUnchanged(immutableCompatibility, '重命名统计周期')

    await openManager()
    click('撤销最新周期')
    await waitFor(() => text().includes('撤销后，上一期将成为当前统计周期'), '撤销最新周期缺少明确确认')
    click('确认撤销')
    await waitFor(() => useStore.getState().livePerformanceCycles.length === 1, '撤销必须只移除最新一期')
    await waitFor(() => !document.querySelector('[data-cycle-manager]'), '撤销最新周期成功后弹窗未关闭')
    assert(useStore.getState().livePerformanceCycles[0]?.id === firstCreated.id, '撤销误删了非最新周期')
    assertCompatibilityUnchanged(immutableCompatibility, '撤销最新统计周期')

    const rollbackBefore = JSON.stringify(useStore.getState().livePerformanceCycles)
    saveAttempts = 0
    storage.saveSnapshot = async () => {
      saveAttempts += 1
      if (saveAttempts === 1) throw new Error('test cycle save failure')
    }
    enablePersistWrites()
    await openManager()
    const rollbackRow = document.querySelector<HTMLElement>(`[data-cycle-id="${firstCreated.id}"]`)
    assert(rollbackRow, '回滚场景缺少目标周期')
    click('重命名', rollbackRow)
    await waitFor(() => Boolean(document.querySelector('input[aria-label="统计周期名称"]')), '回滚场景重命名表单未出现')
    setInput('统计周期名称', '不会落盘的名称')
    click('确认重命名')
    await waitFor(() => saveAttempts === 2, '保存失败后没有持久化回滚')
    await waitFor(
      () => useToast.getState().message === '统计周期保存失败，原设置已保留',
      '保存失败且回滚成功的提示错误',
    )
    const rollbackSucceededCopy = useToast.getState().message
    assert(JSON.stringify(useStore.getState().livePerformanceCycles) === rollbackBefore, '保存失败必须精确恢复旧周期数组内容')
    assert(Boolean(document.querySelector('[data-cycle-manager]')), '保存失败后应保留弹窗供用户核对')
    await closeManager()
    useToast.getState().dismiss()

    saveAttempts = 0
    storage.saveSnapshot = async () => {
      saveAttempts += 1
      throw new Error(saveAttempts === 1 ? 'test cycle save failure' : 'test cycle rollback failure')
    }
    await openManager()
    click('撤销最新周期')
    await waitFor(() => text().includes('撤销后将恢复全部历史统计'), '双失败撤销确认未出现')
    click('确认撤销')
    await waitFor(() => saveAttempts === 2, '保存与回滚双失败场景没有执行两次保存')
    await waitFor(
      () => useToast.getState().message === '统计周期保存与回滚均失败，请重新打开应用核对当前设置',
      '保存与回滚均失败提示错误',
    )
    const rollbackFailedCopy = useToast.getState().message
    assert(
      rollbackSucceededCopy !== rollbackFailedCopy,
      '持久化失败与保存/回滚双失败必须使用不同提示',
    )
    assert(JSON.stringify(useStore.getState().livePerformanceCycles) === rollbackBefore, '双失败后内存仍必须恢复旧周期数组')
    assertCompatibilityUnchanged(immutableCompatibility, '持久化失败回滚')
    await closeManager()
    storage.saveSnapshot = originalSaveSnapshot
    disablePersistWrites()
    useToast.getState().dismiss()

    await openManager()
    click('撤销最新周期')
    await waitFor(() => text().includes('撤销后将恢复全部历史统计'), '唯一周期撤销没有说明全历史口径')
    click('确认撤销')
    await waitFor(() => useStore.getState().livePerformanceCycles.length === 0, '唯一周期撤销后必须恢复空周期')
    await waitFor(() => text().includes('开始新统计周期'), '唯一周期撤销后没有恢复创建入口')
    await waitFor(() => text().includes('+$60'), '唯一周期撤销后 Dashboard 没有恢复全部实盘历史')
    assertCompatibilityUnchanged(immutableCompatibility, '撤销唯一统计周期')
  } finally {
    storage.saveSnapshot = originalSaveSnapshot
    disablePersistWrites()
    useToast.getState().dismiss()
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      weeklyReviews: previous.weeklyReviews,
      livePerformanceCycles: previous.livePerformanceCycles,
      liveStatsStartTradingDayKey: previous.liveStatsStartTradingDayKey,
    })
  }
}

window.__livePerformanceCycleManagerTest = run()

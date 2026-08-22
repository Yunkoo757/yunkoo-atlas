import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { PaperTrade, Trade } from '@/data/trades'
import type { LiveStage } from '@/lib/liveStages'
import { useStore } from '@/store/useStore'
import { LiveArchiveView } from '@/views/LiveArchiveView'
import { DetailView } from '@/views/DetailView'
import { createWeeklyReview } from '@/data/weeklyReviews'
import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPeriodOutcomeSnapshot,
  RiskPolicyVersion,
  WeeklyRiskPreparation,
} from '@/data/riskManagement'

declare global {
  interface Window {
    __liveArchiveViewTest?: Promise<void>
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function waitFor(check: () => boolean, message: string) {
  for (let index = 0; index < 180; index += 1) {
    if (check()) return
    await frame()
  }
  throw new Error(message)
}

function LocationProbe() {
  const location = useLocation()
  return <output data-route>{`${location.pathname}${location.search}`}</output>
}

function trade(id: string, day: string, patch: Partial<Trade> = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy',
    tradeKind: 'live',
    liveStageId: 'stage-current',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: day,
    closedAt: day,
    closedTradingDayKey: day,
    note: '',
    ...patch,
  }
}

function paperTrade(id: string, day: string, patch: Partial<PaperTrade> = {}): PaperTrade {
  const base = trade(id, day)
  if (base.tradeKind !== 'live') throw new Error('paper fixture base must be live')
  const { liveStageId: _liveStageId, tradeKind: _tradeKind, ...fields } = base
  return { ...fields, ...patch, tradeKind: 'paper' }
}

function WorkbenchRoutes() {
  return (
    <Routes>
      <Route path="/live-history" element={<><LiveArchiveView /><LocationProbe /></>} />
      <Route path="/live-history/board" element={<><LiveArchiveView /><LocationProbe /></>} />
      <Route path="/trade/:id" element={<><DetailView /><LocationProbe /></>} />
    </Routes>
  )
}

async function run() {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)
  const stages: LiveStage[] = [
    { id: 'stage-1', sequence: 1, name: '第一阶段', status: 'archived', startsOn: '2025-12-01', endsOn: '2025-12-31', createdAt: '2025-12-01T00:00:00.000Z', archivedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'stage-2', sequence: 2, name: '第二阶段', status: 'archived', startsOn: '2026-01-01', endsOn: '2026-01-31', createdAt: '2026-01-01T00:00:00.000Z', archivedAt: '2026-02-01T00:00:00.000Z' },
    { id: 'stage-current', sequence: 3, name: '当前阶段', status: 'current', startsOn: '2026-02-01', endsOn: null, createdAt: '2026-02-01T00:00:00.000Z', archivedAt: null },
  ]
  const earlierHistorical = trade('earlier-historical', '2099-01-15', { liveStageId: 'stage-1' })
  const historicalWin = trade('historical-win', '2026-08-15', { liveStageId: 'stage-2' })
  const historicalLoss = trade('historical-loss', '2026-08-16', { liveStageId: 'stage-2', status: 'loss', pnl: -100, rMultiple: -1 })
  const historicalCny = trade('historical-cny', '2026-08-17', { liveStageId: 'stage-2', pnl: 700, cashCurrency: 'CNY' })
  const historicalUnknown = trade('historical-unknown', '2026-08-18', { liveStageId: 'stage-2', pnl: 50, cashCurrency: undefined })
  const current = trade('current', '2026-02-15')
  const paperMissingCloseDay = paperTrade('paper-missing-close-day', '2026-08-18', {
    closedAt: null,
    closedTradingDayKey: undefined,
  })
  const paperInvalidCloseDay = paperTrade('paper-invalid-close-day', '2026-08-18', {
    closedTradingDayKey: 'not-a-day',
  })
  const paperFutureCloseDay = paperTrade('paper-future-close-day', '2099-01-01')
  const frozenReview = {
    ...createWeeklyReview('2026-01-12', 'stage-2'),
    status: 'completed' as const,
    completedAt: '2026-01-18T12:00:00.000Z',
    metricsSnapshot: {
      tradeCount: 2,
      reviewedCount: 2,
      evaluatedCount: 2,
      winCount: 1,
      lossCount: 1,
      breakevenCount: 0,
      conflictCount: 0,
      pendingResultCount: 0,
      winRate: 50,
      pnlCount: 2,
      totalPnl: 777,
      rCount: 2,
      averageR: 1.5,
      mistakeTagCounts: {},
      missedCount: 0,
      missedReasonCounts: {},
    },
  }
  const outcome: RiskPeriodOutcomeSnapshot = {
    netBudgetR: -1,
    limitR: 3,
    consumedR: 1,
    remainingR: 2,
    progress: 1 / 3,
    coverage: 'complete',
    triggered: false,
    includedTradeCount: 1,
    excludedTradeCount: 0,
    unknownReasons: [],
  }
  const preparation: WeeklyRiskPreparation = {
    id: 'prep-stage-2',
    liveStageId: 'stage-2',
    weekStart: '2026-08-17',
    draft: {
      capitalBase: 10_000,
      riskPercent: 1,
      riskAmount: 100,
      dailyLossLimitR: 2,
      weeklyLossLimitR: 4,
      monthlyLossLimitRDefault: 8,
      disciplineText: '阶段二风险纪律',
    },
    reviewedAt: '2026-08-17T00:00:00.000Z',
    confirmedPolicyVersionId: 'policy-stage-2',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  }
  const policy: RiskPolicyVersion = {
    id: 'policy-stage-2',
    liveStageId: 'stage-2',
    sourceWeekStart: '2026-08-17',
    effectiveTradingDay: '2026-08-17',
    capitalBase: 10_000,
    riskPercent: 1,
    riskAmount: 100,
    dailyLossLimitR: 2,
    weeklyLossLimitR: 4,
    monthlyLossLimitRDefault: 8,
    disciplineText: '阶段二风险纪律',
    confirmedAt: '2026-08-17T00:00:00.000Z',
  }
  const monthlyLimit: MonthlyRiskLimit = {
    id: 'limit-stage-2',
    liveStageId: 'stage-2',
    monthKey: '2026-08',
    limitR: 8,
    sourcePolicyVersionId: policy.id,
    lockedAt: '2026-08-17T00:00:00.000Z',
  }
  const override: RiskOverrideEvent = {
    id: 'override-stage-2',
    liveStageId: 'stage-2',
    tradeId: historicalLoss.id,
    tradeIdentityAtDecision: { ref: historicalLoss.ref, symbol: historicalLoss.symbol, tradeKind: 'live' },
    linkState: 'resolved',
    decisionType: 'triggered',
    tradingDayKeyAtDecision: '2026-08-16',
    policyVersionId: policy.id,
    createdAt: '2026-08-16T00:00:00.000Z',
    reason: '阶段二人工覆盖',
    fingerprint: 'stage-2-fingerprint',
    outcomesAtDecision: { day: outcome, week: outcome, month: outcome },
    unknownReasons: [],
  }

  try {
    useStore.setState((state) => ({
      trades: [
        earlierHistorical,
        historicalWin,
        historicalLoss,
        historicalCny,
        historicalUnknown,
        current,
        paperMissingCloseDay,
        paperInvalidCloseDay,
        paperFutureCloseDay,
        trade('case-mistake', '2026-01-15', {
          ref: 'CAS-MISTAKE',
          tradeKind: 'case',
          liveStageId: 'stage-2',
          status: 'loss',
          sourceTradeId: historicalWin.id,
          caseType: 'mistake',
          mistakeTags: ['追单'],
        }),
        trade('case-mastered', '2026-01-15', {
          ref: 'CAS-MASTERED',
          tradeKind: 'case',
          liveStageId: 'stage-2',
          sourceTradeId: historicalWin.id,
          masteryState: 'mastered',
          reviewStatus: 'reviewed',
        }),
        trade('case-current', '2026-02-15', {
          ref: 'CAS-CURRENT',
          tradeKind: 'case',
          liveStageId: 'stage-current',
          sourceTradeId: current.id,
        }),
        trade('case-unlinked', '2026-01-15', {
          ref: 'CAS-UNLINKED',
          tradeKind: 'case',
          liveStageId: null,
          sourceTradeId: undefined,
        }),
      ],
      strategies: [{ id: 'strategy', name: '测试策略', icon: 'target', color: '#5e6ad2' }],
      liveStages: stages,
      currentLiveStageId: 'stage-current',
      weeklyReviews: [frozenReview],
      weeklyRiskPreparations: [
        preparation,
        { ...preparation, id: 'prep-current', liveStageId: 'stage-current', draft: { ...preparation.draft, disciplineText: '当前阶段风险纪律' } },
      ],
      riskPolicyVersions: [policy, { ...policy, id: 'policy-current', liveStageId: 'stage-current', disciplineText: '当前阶段风险纪律' }],
      monthlyRiskLimits: [monthlyLimit, { ...monthlyLimit, id: 'limit-current', liveStageId: 'stage-current', monthKey: '2026-09' }],
      riskOverrideEvents: [override, { ...override, id: 'override-current', liveStageId: 'stage-current', reason: '当前阶段人工覆盖' }],
      livePerformanceCycles: [],
      display: {
        ...state.display,
        hideClosed: false,
        groupByDate: true,
        groupByStrategy: false,
        tradingDayStartHour: 0,
      },
    }))

    root.render(
      <MemoryRouter initialEntries={['/live-history?liveStage=all-history&tab=live']}>
        <WorkbenchRoutes />
      </MemoryRouter>,
    )

    await waitFor(() => Boolean(document.querySelector('[data-trade-id="historical-win"]')), '历史实盘必须显示重置前交易')
    assert(document.querySelector('[data-trade-id="earlier-historical"]'), '全部历史必须包含每个已归档 stage')
    assert(!document.querySelector('[data-trade-id="current"]'), '历史实盘不得显示当前实盘')
    const stageButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-live-stage-id]')]
    assert(stageButtons.map((button) => button.dataset.liveStageId).join() === 'all-history,stage-2,stage-1', '历史 stage 导航必须先全部历史，再按 sequence 倒序')
    const contentTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-live-archive-tab]')]
    assert(contentTabs.map((button) => button.textContent?.trim()).join() === '概览,实盘记录,关联案例,周复盘,风险记录', '历史页必须提供五个独立内容 tab')
    assert(document.querySelector('.quick-view-bar'), '历史实盘必须复用交易工作台快捷视图栏')
    assert(document.querySelector('.ui-filter-shell'), '历史实盘必须复用交易工作台筛选器')
    assert(document.querySelector('[role="group"][aria-label="视图切换"] button[data-value="list"]'), '历史实盘必须复用列表视图控制')
    assert(document.querySelector('[role="group"][aria-label="视图切换"] button[data-value="board"]'), '历史实盘必须复用看板视图控制')
    assert(!document.querySelector('.la-view'), '历史实盘不得继续维护独立页面壳')
    assert(document.body.textContent?.includes('2099年1月'), '历史实盘必须使用标准月份分组，日期不得改变 stage 归属')

    stageButtons.find((button) => button.dataset.liveStageId === 'stage-2')?.click()
    await waitFor(() => document.querySelector('[data-route]')?.textContent === '/live-history?liveStage=stage-2&tab=live', '切换 stage 必须更新 liveStage 并保留内容 tab')
    assert(!document.querySelector('[data-trade-id="earlier-historical"]'), '单 stage 投影不得混入其他归档 stage')

    ;[...document.querySelectorAll<HTMLButtonElement>('.quick-view-chip')]
      .find((button) => button.textContent?.trim() === '亏损')?.click()
    await waitFor(() => Boolean(document.querySelector('[data-trade-id="historical-loss"]')), '历史快捷筛选必须留在历史范围')
    assert(!document.querySelector('[data-trade-id="historical-win"]'), '亏损快捷筛选必须使用统一工作台筛选逻辑')
    assert(document.querySelector('[data-route]')?.textContent === '/live-history?liveStage=stage-2&tab=live&status=loss', '历史筛选必须保留 stage 与内容 tab')

    document.querySelector<HTMLButtonElement>('[data-trade-id="historical-loss"] .trade-row-open')?.click()
    await waitFor(() => Boolean(document.querySelector('.dv-back')), '历史行必须继续打开原交易详情')
    document.querySelector<HTMLAnchorElement>('.dv-back')?.click()
    await waitFor(() => document.querySelector('[data-route]')?.textContent === '/live-history?liveStage=stage-2&tab=live&status=loss', '详情返回必须恢复 stage、过滤与列表模式')
    await waitFor(() => Boolean(document.querySelector('[data-trade-id="historical-loss"]')), '详情返回必须恢复历史行锚点')

    document.querySelector<HTMLButtonElement>('[role="group"][aria-label="视图切换"] button[data-value="board"]')?.click()
    const liveBoardRoute = '/live-history/board?liveStage=stage-2&tab=live&status=loss'
    await waitFor(() => document.querySelector('[data-route]')?.textContent === liveBoardRoute, '历史实盘切换看板必须保留 stage、tab 与过滤')
    document.querySelector<HTMLElement>('[data-trade-id="historical-loss"]')?.click()
    await waitFor(() => Boolean(document.querySelector('.dv-back')), '历史实盘看板卡必须打开原交易详情')
    document.querySelector<HTMLAnchorElement>('.dv-back')?.click()
    await waitFor(() => document.querySelector('[data-route]')?.textContent === liveBoardRoute, '实盘看板详情返回必须恢复 stage、tab、过滤与 board 模式')
    await waitFor(() => document.querySelector('[data-trade-id="historical-loss"]')?.contains(document.activeElement) ?? false, '实盘看板详情返回必须恢复滚动锚点焦点')

    ;[...document.querySelectorAll<HTMLButtonElement>('[data-live-archive-tab]')]
      .find((button) => button.textContent?.trim() === '概览')?.click()
    await waitFor(() => document.querySelector('[data-archive-total-pnl]')?.textContent === '$0', '历史 overview 必须只汇总 USD 当前事实')
    assert(document.querySelector('[data-currency-merge-status="usd-with-exclusions"]'), '历史 overview 必须暴露混合币种完整性状态')
    assert(document.body.textContent?.includes('USD 覆盖 2/4 笔'), '历史 overview 必须展示 USD 覆盖率')
    assert(document.body.textContent?.includes('CNY 1 笔') && document.body.textContent?.includes('未知币种 1 笔'), '历史 overview 必须列出被排除币种且不得相加')
    assert(document.querySelector('[data-archive-strategy-id="strategy"]')?.textContent?.includes('$0'), '历史 overview 必须展示 stage 内策略拆分')
    assert(!document.querySelector('[data-archive-close-day-health]'), '外部 paper 的缺少、无效、未来平仓日不得污染所选历史 stage 完整性')
    useStore.setState((state) => ({
      trades: state.trades.map((item) => item.id === historicalLoss.id ? { ...item, pnl: -300 } : item),
    }))
    await waitFor(() => document.querySelector('[data-archive-total-pnl]')?.textContent === '-$200', '编辑历史事实后 overview 必须实时重算')

    useStore.setState((state) => ({ display: { ...state.display, privacyMode: true } }))
    await waitFor(() => document.querySelector('[data-archive-total-pnl]')?.textContent === '****', '隐私模式必须隐藏历史 overview 现金')
    assert(!document.body.textContent?.includes('$200'), '隐私模式不得在策略拆分泄露 overview 现金')

    ;[...document.querySelectorAll<HTMLButtonElement>('[data-live-archive-tab]')]
      .find((button) => button.textContent?.trim() === '周复盘')?.click()
    await waitFor(() => document.querySelector('[data-weekly-source="snapshot"]')?.textContent?.includes('****') ?? false, '历史周复盘冻结快照也必须遵守隐私模式')
    assert(!document.body.textContent?.includes('$777'), '隐私模式不得泄露冻结周复盘现金')
    assert(document.querySelector('[data-weekly-source="snapshot"]'), '历史周复盘必须显式标记冻结快照来源')

    ;[...document.querySelectorAll<HTMLButtonElement>('[data-live-archive-tab]')]
      .find((button) => button.textContent?.trim() === '风险记录')?.click()
    await waitFor(() => Boolean(document.querySelector('[data-risk-preparation-id="prep-stage-2"]')), '风险 tab 必须显示 stage 内周准备实体')
    assert(document.querySelector('[data-risk-policy-id="policy-stage-2"]')?.textContent?.includes('阶段二风险纪律'), '风险 tab 必须显示 stage 内策略版本事实')
    assert(document.querySelector('[data-risk-limit-id="limit-stage-2"]')?.textContent?.includes('2026-08'), '风险 tab 必须显示 stage 内月度限额事实')
    assert(document.querySelector('[data-risk-override-id="override-stage-2"]')?.textContent?.includes('阶段二人工覆盖'), '风险 tab 必须显示 stage 内覆盖事件事实')
    assert(!document.body.textContent?.includes('当前阶段风险纪律') && !document.body.textContent?.includes('当前阶段人工覆盖'), '风险 tab 不得混入当前 stage 风险记录')
    assert(!document.body.textContent?.includes('$100'), '风险 tab 现金字段必须遵守隐私模式')

    ;[...document.querySelectorAll<HTMLButtonElement>('[data-live-archive-tab]')]
      .find((button) => button.textContent?.trim() === '关联案例')?.click()

    await waitFor(() => Boolean(document.querySelector('[data-trade-id="case-mistake"]')), '关联案例必须复用同一工作台显示')
    assert(!document.querySelector('[data-trade-id="case-current"]'), '关联案例不得混入当前实盘来源案例')
    assert(!document.querySelector('[data-trade-id="case-unlinked"]'), '关联案例不得混入无来源案例')
    assert(document.querySelector('[data-route]')?.textContent?.includes('status=loss'), '切换内容 tab 必须保留既有过滤查询')

    ;[...document.querySelectorAll<HTMLButtonElement>('.quick-view-chip')]
      .find((button) => button.textContent?.trim() === '错题')?.click()
    await waitFor(() => Boolean(document.querySelector('[data-trade-id="case-mistake"]')), '错题视图必须筛选历史关联案例')
    await waitFor(() => document.querySelector('[data-route]')?.textContent?.includes('caseScope=mistakes') ?? false, '错题筛选必须先写入历史查询')
    await waitFor(() => !document.querySelector('[data-route]')?.textContent?.includes('status=loss'), '切换错题快捷视图必须完成查询身份替换')
    await waitFor(() => !document.querySelector('[data-route]')?.textContent?.includes('view=cases'), '历史案例查询必须完成 tab 规范化')
    assert(!document.querySelector('[data-trade-id="case-mastered"]'), '错题视图不得混入已掌握案例')

    document.querySelector<HTMLButtonElement>('[role="group"][aria-label="视图切换"] button[data-value="board"]')?.click()
    await waitFor(() => document.querySelector('[data-route]')?.textContent?.startsWith('/live-history/board') ?? false, '历史实盘必须支持标准看板')
    assert(document.querySelector('[data-route]')?.textContent?.includes('liveStage=stage-2'), '切换看板必须保留所选 stage')
    assert(document.querySelector('[data-route]')?.textContent?.includes('tab=cases'), '切换看板必须保留内容 tab')
    assert(document.querySelector('.board-scroll'), '历史实盘看板必须复用标准 BoardView')

    const caseBoardRoute = document.querySelector('[data-route]')?.textContent ?? ''
    document.querySelector<HTMLElement>('[data-trade-id="case-mistake"]')?.click()
    await waitFor(() => Boolean(document.querySelector('.dv-back')), '历史案例看板卡必须打开原案例详情')
    document.querySelector<HTMLAnchorElement>('.dv-back')?.click()
    await waitFor(() => document.querySelector('[data-route]')?.textContent?.startsWith('/live-history/board') ?? false, '案例看板详情必须返回历史 board')
    assert(document.querySelector('[data-route]')?.textContent === caseBoardRoute, `案例看板详情返回必须恢复 stage、tab、过滤与 board 模式：${document.querySelector('[data-route]')?.textContent ?? '无路由'}`)
    await waitFor(() => document.querySelector('[data-trade-id="case-mistake"]')?.contains(document.activeElement) ?? false, '案例看板详情返回必须恢复滚动锚点焦点')
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      liveStages: previous.liveStages,
      currentLiveStageId: previous.currentLiveStageId,
      weeklyReviews: previous.weeklyReviews,
      weeklyRiskPreparations: previous.weeklyRiskPreparations,
      riskPolicyVersions: previous.riskPolicyVersions,
      monthlyRiskLimits: previous.monthlyRiskLimits,
      riskOverrideEvents: previous.riskOverrideEvents,
      livePerformanceCycles: previous.livePerformanceCycles,
      display: previous.display,
    })
  }
}

window.__liveArchiveViewTest = run()

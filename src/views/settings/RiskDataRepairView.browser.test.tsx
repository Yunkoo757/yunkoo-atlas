import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { tradeReturnLocationState } from '@/hooks/useTradeReturnAnchor'
import { RiskDataRepairView } from '@/views/settings/RiskDataRepairView'
import { SettingsLayout } from '@/views/settings/SettingsLayout'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window { __riskDataRepairViewBrowserTest?: Promise<void> }
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

function priorTradingDay(currentDay: string): string {
  const date = parseLocalDate(currentDay)
  date.setDate(date.getDate() - 1)
  return getTradingDayKey(date, 0)
}

function liveTrade(currentDay: string, overrides: Partial<Trade>): Trade {
  return {
    id: 'risk-repair-trade',
    ref: 'TRD-REPAIR-1',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'loss',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: 90,
    size: 1,
    pnl: null,
    rMultiple: -1,
    resultSource: 'r',
    openedAt: currentDay,
    closedAt: currentDay,
    closedTradingDayKey: currentDay,
    note: '',
    ...overrides,
  }
}

function TradeRouteProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as { from?: {
    pathname?: string
    search?: string
    anchorTradeId?: string
  } } | null)?.from
  return (
    <section data-trade-route-probe>
      <span data-trade-route-source={from?.pathname ?? ''}>{from?.pathname ?? ''}</span>
      <span data-trade-route-search={from?.search ?? ''}>{from?.search ?? ''}</span>
      <span data-trade-route-anchor={from?.anchorTradeId ?? ''}>{from?.anchorTradeId ?? ''}</span>
      <button
        type="button"
        onClick={() => navigate(
          { pathname: from?.pathname ?? '/list', search: from?.search ?? '' },
          { state: tradeReturnLocationState(from?.pathname ? {
            pathname: from.pathname,
            search: from.search,
            anchorTradeId: from.anchorTradeId,
          } : undefined) },
        )}
      >
        返回修复中心
      </button>
    </section>
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output data-location-search={location.search}>{location.search}</output>
}

function Harness() {
  return (
    <MemoryRouter initialEntries={['/settings/risk/data-repair']}>
      <LocationProbe />
      <Routes>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route path="risk/data-repair" element={<RiskDataRepairView />} />
          <Route path="data" element={<div>数据管理</div>} />
        </Route>
        <Route path="/trade/:id" element={<TradeRouteProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  try {
    const currentDay = getTradingDayKey(new Date(), 0)
    const closedDay = priorTradingDay(currentDay)
    const blockingTrade = liveTrade(closedDay, {
      id: 'risk-repair-loss',
      ref: 'TRD-REPAIR-LOSS',
      pnl: null,
      rMultiple: -1,
      resultSource: 'r',
    })
    const completenessTrade = liveTrade(closedDay, {
      id: 'risk-repair-win',
      ref: 'TRD-REPAIR-WIN',
      status: 'win',
      pnl: null,
      rMultiple: 1,
      resultSource: 'r',
    })
    const retainedHistory = liveTrade(closedDay, {
      id: 'risk-repair-history',
      ref: 'TRD-REPAIR-HISTORY',
      pnl: -100,
      rMultiple: null,
      resultSource: 'pnl',
    })
    useStore.setState((state) => ({
      trades: [blockingTrade, completenessTrade, retainedHistory],
      weeklyRiskPreparations: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      liveStatsStartTradingDayKey: closedDay,
      display: { ...state.display, privacyMode: false, tradingDayStartHour: 0 },
    }))
    root.render(<Harness />)

    await waitFor(() => document.querySelector('[data-risk-data-repair-view]') !== null, '风险数据修复中心没有渲染')
    let view = document.querySelector<HTMLElement>('[data-risk-data-repair-view]')
    if (!view) throw new Error('风险数据修复中心没有渲染')
    if (!view.textContent?.includes('优先处理') || !view.textContent?.includes('补全数据')) {
      throw new Error('修复中心缺少两级问题区域')
    }
    if (!view.textContent?.includes('历史风险规则不可回填')) {
      throw new Error('保留型历史缺口缺少真实说明')
    }
    const next = view.querySelector<HTMLAnchorElement>('[data-risk-repair-next]')
    if (!next?.textContent?.includes('处理下一项')) throw new Error('缺少唯一下一项动作')
    const expanded = [...view.querySelectorAll<HTMLElement>('[data-risk-repair-group]')]
      .filter((group) => group.getAttribute('data-expanded') === 'true')
    if (expanded.length !== 1) throw new Error('修复中心必须只展开一个原因分组')

    const alternateGroup = [...view.querySelectorAll<HTMLElement>('[data-risk-repair-group]')]
      .find((group) => group.getAttribute('data-expanded') === 'false')
    const alternateToggle = alternateGroup?.querySelector<HTMLButtonElement>('button')
    if (!alternateToggle) throw new Error('修复中心缺少可切换的原因分组')
    alternateToggle.click()
    await waitFor(() => alternateGroup?.getAttribute('data-expanded') === 'true', '切换原因分组失败')
    if (!document.querySelector('[data-location-search]')?.textContent?.includes('group=')) {
      throw new Error('切换原因分组没有写入 URL')
    }

    view = document.querySelector<HTMLElement>('[data-risk-data-repair-view]')
    if (!view) throw new Error('切换后修复中心没有渲染')
    const selectedTrade = alternateGroup?.querySelector<HTMLElement>('[data-trade-id]')
    const selectedTradeId = selectedTrade?.dataset.tradeId
    const tradeLink = selectedTrade?.querySelector<HTMLAnchorElement>('a')
    if (!selectedTradeId || !tradeLink) throw new Error('当前原因分组缺少交易动作')
    tradeLink.click()
    await waitFor(() => document.querySelector('[data-trade-route-probe]') !== null, '没有进入交易详情')
    if (document.querySelector('[data-trade-route-source]')?.getAttribute('data-trade-route-source') !== '/settings/risk/data-repair') {
      throw new Error('交易详情没有携带修复中心返回来源')
    }
    if (!document.querySelector('[data-trade-route-search]')?.textContent?.includes('group=')) {
      throw new Error('交易详情没有保留当前原因分组')
    }
    if (document.querySelector('[data-trade-route-anchor]')?.getAttribute('data-trade-route-anchor') !== selectedTradeId) {
      throw new Error('交易详情没有携带返回锚点交易')
    }
    document.querySelector<HTMLButtonElement>('[data-trade-route-probe] button')?.click()
    await waitFor(() => document.querySelector('[data-risk-data-repair-view]') !== null, '没有返回修复中心')
    await waitFor(() => {
      const target = document.querySelector<HTMLElement>(`[data-trade-id="${selectedTradeId}"]`)
      return document.activeElement === target || Boolean(target?.contains(document.activeElement))
    }, '返回后没有恢复到对应交易')

    const nextDay = parseLocalDate(currentDay)
    nextDay.setDate(nextDay.getDate() + 1)
    useStore.setState({ liveStatsStartTradingDayKey: getTradingDayKey(nextDay, 0) })
    await waitFor(() => {
      const page = document.querySelector<HTMLElement>('[data-risk-data-repair-view]')
      return page?.textContent?.includes('风险核算起点晚于当前交易日') ?? false
    }, '全局核算起点问题没有出现')
    view = document.querySelector<HTMLElement>('[data-risk-data-repair-view]')
    if (!view) throw new Error('全局问题阶段缺少修复中心')
    if (view.querySelector('[data-trade-id]')) throw new Error('全局问题阶段不应保留交易分组')
    const cycleSettings = [...view.querySelectorAll<HTMLAnchorElement>('a[href="/settings/data"]')]
      .find((link) => link.textContent?.includes('调整核算起点'))
    if (!cycleSettings) throw new Error('全局问题缺少核算起点动作')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__riskDataRepairViewBrowserTest = run()

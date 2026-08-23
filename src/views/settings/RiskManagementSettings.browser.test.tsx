import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { weekStartFor } from '@/data/weeklyReviews'
import { SettingsLayout } from '@/views/settings/SettingsLayout'
import { RiskManagementSettingsPanel } from '@/views/settings/RiskManagementSettingsPanel'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window { __riskManagementSettingsBrowserTest?: Promise<void> }
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

function dirtyLoss(currentDay: string): Trade {
  return {
    id: 'risk-dirty-loss',
    ref: 'TRD-RISK-1',
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
    liveStageId: useStore.getState().currentLiveStageId,
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
  }
}

function Harness() {
  const [panelKey, setPanelKey] = useState(0)
  return (
    <MemoryRouter initialEntries={['/settings/risk']}>
      <button hidden type="button" data-remount-settings onClick={() => setPanelKey((value) => value + 1)}>
        重挂风险设置
      </button>
      <Routes>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route path="risk" element={<RiskManagementSettingsPanel key={panelKey} />} />
        </Route>
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
    const priorDay = parseLocalDate(currentDay)
    priorDay.setDate(priorDay.getDate() - 1)
    const incompleteTrade = dirtyLoss(getTradingDayKey(priorDay, 0))
    const partialTrade: Trade = {
      ...incompleteTrade,
      id: 'risk-partial-win',
      ref: 'TRD-RISK-2',
      symbol: 'ETHUSDT',
      status: 'win',
      rMultiple: 1,
    }
    useStore.setState((state) => ({
      liveStages: state.liveStages.map((stage) => stage.id === state.currentLiveStageId
        ? { ...stage, startsOn: incompleteTrade.openedAt.slice(0, 10) }
        : stage),
      trades: [incompleteTrade, partialTrade],
      weeklyRiskPreparations: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      display: { ...state.display, privacyMode: false, tradingDayStartHour: 0 },
    }))
    root.render(<Harness />)
    await waitFor(
      () => document.querySelector('.settings-nav-item.is-active')?.textContent?.trim() === '风险管理',
      '风险管理导航没有激活',
    )
    let panel = document.querySelector<HTMLElement>('[data-risk-management-settings]')
    if (!panel) throw new Error('风险管理设置页没有渲染')
    if (!panel.textContent?.includes('日止损线') || !panel.textContent?.includes('周止损线')) {
      throw new Error('风险管理设置页缺少周期限额')
    }
    if (!panel.textContent?.includes('保存风险基准')) throw new Error('设置页缺少风险基准保存动作')
    await waitFor(() => panel?.querySelector('[data-risk-data-summary]') !== null, '设置页没有显示风险数据摘要')
    const preparation = panel.querySelector<HTMLElement>('[data-risk-preparation]')
    const summary = panel.querySelector<HTMLElement>('[data-risk-data-summary]')
    if (!preparation || !summary) throw new Error('风险设置页缺少规则或数据摘要')
    if (!(preparation.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      throw new Error('本周风险规则必须显示在数据摘要之前')
    }
    if (!summary.textContent?.includes('全局设置 0') || !summary.textContent?.includes('阻断判断 1') || !summary.textContent?.includes('影响完整度 1')) {
      throw new Error('风险数据摘要没有显示三类独立计数')
    }
    if (panel.textContent?.includes('亏损交易缺少盈亏金额')) {
      throw new Error('风险设置页不得继续渲染逐条问题原因')
    }
    const repairLink = summary.querySelector<HTMLAnchorElement>('a[href="/settings/risk/data-repair"]')
    if (repairLink?.textContent?.trim() !== '开始修复') throw new Error('可修复问题必须提供开始修复入口')

    if (new URLSearchParams(location.search).get('visual') === 'cards') {
      await new Promise<void>(() => {})
    }

    const capital = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('资金基准'))
      ?.querySelector<HTMLInputElement>('input')
    if (!capital) throw new Error('设置页缺少资金基准输入')
    const riskAmount = panel.querySelector<HTMLInputElement>('[aria-label="1R 金额"]')
    if (!riskAmount) throw new Error('设置页缺少 1R 金额输入')
    const daily = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('日止损线'))
      ?.querySelector<HTMLInputElement>('input')
    if (!daily) throw new Error('设置页缺少日止损线输入')
    const confirm = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '保存风险基准')
    if (!confirm) throw new Error('设置页缺少确认按钮')
    useStore.getState().saveRiskBaseline({
      currentTradingDayKey: currentDay,
      weekStart: weekStartFor(parseLocalDate(currentDay)),
      draft: {
        capitalBase: 100_000,
        riskPercent: 1,
        riskAmount: 1_000,
        dailyLossLimitR: 2.5,
        weeklyLossLimitR: 5,
        monthlyLossLimitRDefault: 10,
        disciplineText: '触线后停止开仓，先复核执行偏差。',
      },
      confirmedAt: new Date().toISOString(),
      policyVersionId: 'risk-policy:settings-browser',
    })
    await waitFor(() => panel.textContent?.includes('当前阶段风险基准已设置') ?? false, '风险基准保存没有完成')
    if (panel.querySelector('input')) throw new Error('确认后设置页必须回到只读摘要')

    const currentMonth = currentDay.slice(0, 7)
    if (useStore.getState().weeklyRiskPreparations.length !== 0) throw new Error('新流程不得生成每周风险准备记录')
    if (useStore.getState().riskPolicyVersions.length !== 1) throw new Error('首次确认必须生成一个规则版本')
    const firstMonthLimit = useStore.getState().monthlyRiskLimits.find((item) => item.monthKey === currentMonth)
    if (firstMonthLimit?.limitR !== 10) {
      throw new Error(`首次确认必须建立并锁定当前月限额：${JSON.stringify(useStore.getState().monthlyRiskLimits)}`)
    }
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__riskManagementSettingsBrowserTest = run()

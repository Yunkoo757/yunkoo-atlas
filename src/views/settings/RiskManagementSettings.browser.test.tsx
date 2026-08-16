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

function setText(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('浏览器缺少 input value setter')
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
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
    if (!panel.textContent?.includes('确认本周规则')) throw new Error('设置页缺少每周确认动作')
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
    setText(capital, '100000')
    await frame()
    const riskAmount = panel.querySelector<HTMLInputElement>('[aria-label="1R 金额"]')
    if (!riskAmount) throw new Error('设置页缺少 1R 金额输入')
    setText(riskAmount, '1000')
    await frame()
    const daily = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('日止损线'))
      ?.querySelector<HTMLInputElement>('input')
    if (!daily) throw new Error('设置页缺少日止损线输入')
    setText(daily, '2.5')
    await waitFor(
      () => useStore.getState().weeklyRiskPreparations[0]?.draft.dailyLossLimitR === 2.5,
      '未复核输入没有持久化草稿',
    )
    document.querySelector<HTMLButtonElement>('[data-remount-settings]')?.click()
    await waitFor(
      () => document.querySelector<HTMLInputElement>('[data-risk-preparation] input') !== daily,
      '风险设置页没有卸载并重挂载',
    )
    panel = document.querySelector<HTMLElement>('[data-risk-management-settings]')
    if (!panel) throw new Error('重挂载后风险管理设置页不存在')
    const remountedDaily = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('日止损线'))
      ?.querySelector<HTMLInputElement>('input')
    if (remountedDaily?.value !== '2.5') throw new Error('未复核草稿在卸载/重挂载后没有保留')
    const confirm = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '确认本周规则')
    if (!confirm) throw new Error('设置页缺少确认按钮')
    confirm.click()
    await waitFor(() => panel.textContent?.includes('本周风险规则已复核') ?? false, '设置页确认没有完成')
    if (panel.querySelector('input')) throw new Error('确认后设置页必须回到只读摘要')

    const currentWeek = weekStartFor(parseLocalDate(currentDay))
    const currentMonth = currentDay.slice(0, 7)
    const firstPreparation = useStore.getState().weeklyRiskPreparations.find((item) => item.weekStart === currentWeek)
    if (!firstPreparation?.reviewedAt || !firstPreparation.confirmedPolicyVersionId) {
      throw new Error('首次确认没有保存已复核准备状态')
    }
    if (useStore.getState().riskPolicyVersions.length !== 1) throw new Error('首次确认必须生成一个规则版本')
    const firstMonthLimit = useStore.getState().monthlyRiskLimits.find((item) => item.monthKey === currentMonth)
    if (firstMonthLimit?.limitR !== 10) {
      throw new Error(`首次确认必须建立并锁定当前月限额：${JSON.stringify(useStore.getState().monthlyRiskLimits)}`)
    }

    useStore.setState({
      trades: [
        {
          ...incompleteTrade,
          pnl: -1_000,
          rMultiple: null,
          resultSource: 'pnl',
          closedAt: currentDay,
          closedTradingDayKey: currentDay,
        },
        {
          ...partialTrade,
          pnl: 1_000,
          rMultiple: null,
          resultSource: 'pnl',
          closedAt: currentDay,
          closedTradingDayKey: currentDay,
        },
      ],
    })
    await waitFor(() => document.querySelector('[data-risk-data-complete]') !== null, '修复交易后问题没有自动消失')
    const completeSummary = panel.querySelector<HTMLElement>('[data-risk-data-summary]')
    if (completeSummary?.querySelector('a')) throw new Error('风险数据完整时不应提供修复入口')

    const reviewedPolicyCount = useStore.getState().riskPolicyVersions.length
    const edit = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '修改规则')
    if (!edit) throw new Error('设置页缺少修改规则按钮')
    edit.click()
    await waitFor(() => Boolean(panel.querySelector('input')), '修改规则没有展开本地草稿')
    const editedDaily = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('日止损线'))
      ?.querySelector<HTMLInputElement>('input')
    if (!editedDaily) throw new Error('已复核设置缺少日止损草稿输入')
    setText(editedDaily, '3')
    await frame()
    const preparationDuringEdit = useStore.getState().weeklyRiskPreparations.find((item) => item.weekStart === currentWeek)
    if (preparationDuringEdit?.reviewedAt !== firstPreparation.reviewedAt) {
      throw new Error('本地修改不得提前清除 reviewedAt')
    }
    if (preparationDuringEdit?.draft.dailyLossLimitR !== firstPreparation.draft.dailyLossLimitR) {
      throw new Error('本地修改不得提前写入 Store 草稿')
    }
    const cancel = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '取消修改')
    if (!cancel) throw new Error('设置页缺少取消修改按钮')
    cancel.click()
    await waitFor(() => !panel.querySelector('input'), '取消修改没有回到已复核摘要')
    if (useStore.getState().riskPolicyVersions.length !== reviewedPolicyCount) {
      throw new Error('取消修改不得生成规则版本')
    }

    const reopen = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '修改规则')
    if (!reopen) throw new Error('取消后缺少再次修改动作')
    reopen.click()
    await waitFor(() => Boolean(panel.querySelector('[aria-label="1R 金额"]')), '再次修改没有展开本地草稿')
    const editedRiskAmount = panel.querySelector<HTMLInputElement>('[aria-label="1R 金额"]')
    if (!editedRiskAmount) throw new Error('设置页必须允许直接编辑 1R 金额')
    setText(editedRiskAmount, '1250')
    const futureMonthInput = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('起未来月止损默认'))
      ?.querySelector<HTMLInputElement>('input')
    if (!futureMonthInput) throw new Error('月字段必须明确为未来月默认值')
    setText(futureMonthInput, '12')
    const secondConfirm = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '确认本周规则')
    if (!secondConfirm) throw new Error('修改后缺少再次确认动作')
    secondConfirm.click()
    await waitFor(
      () => useStore.getState().riskPolicyVersions.length === reviewedPolicyCount + 1,
      '再次确认没有保存新规则版本',
    )
    const revisedPolicy = useStore.getState().riskPolicyVersions.at(-1)
    if (!revisedPolicy || revisedPolicy.effectiveTradingDay <= currentDay) {
      throw new Error('再次确认必须生成未来生效的规则版本')
    }
    if (Math.abs(revisedPolicy.riskPercent - 1.25) >= 1e-9 || revisedPolicy.riskAmount !== 1_250) {
      throw new Error('再次确认没有保存修改后的 1R 金额与比例')
    }
    if (useStore.getState().monthlyRiskLimits.find((item) => item.monthKey === currentMonth)?.limitR !== 10) {
      throw new Error('修改未来月默认值不得覆盖当前月锁定值')
    }
    await waitFor(
      () => panel.textContent?.includes(`将于 ${revisedPolicy.effectiveTradingDay} 起生效`) ?? false,
      '已复核但待生效的规则必须展示生效日期',
    )
    if (!panel.textContent?.includes('日 2.5R · 周 5.0R · 本月 10.0R')) {
      throw new Error('未来规则摘要必须继续展示当前月锁定限额')
    }

    useStore.setState((state) => ({ display: { ...state.display, privacyMode: true } }))
    const privateEdit = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '修改规则')
    if (!privateEdit) throw new Error('设置页缺少隐私模式修改规则按钮')
    privateEdit.click()
    await waitFor(() => panel.querySelector<HTMLInputElement>('[aria-label="1R 金额"]')?.type === 'password', '隐私模式没有掩码 1R 金额')
    const privateCapital = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('资金基准'))
      ?.querySelector<HTMLInputElement>('input')
    if (privateCapital?.type !== 'password') throw new Error('隐私模式没有掩码资金基准')

    useStore.setState((state) => ({
      trades: [{
        ...incompleteTrade,
        id: 'risk-retained-history',
        pnl: -1_000,
        rMultiple: null,
        resultSource: 'pnl',
        closedAt: getTradingDayKey(priorDay, 0),
        closedTradingDayKey: getTradingDayKey(priorDay, 0),
      }],
      liveStatsStartTradingDayKey: getTradingDayKey(priorDay, 0),
      display: { ...state.display, privacyMode: false },
    }))
    await waitFor(() => panel?.querySelector('[data-risk-data-summary]')?.textContent?.includes('仍会如实影响完整度') ?? false, '纯历史缺口没有持续影响完整度')
    const retainedSummary = panel.querySelector<HTMLElement>('[data-risk-data-summary]')
    const retainedLink = retainedSummary?.querySelector<HTMLAnchorElement>('a[href="/settings/risk/data-repair"]')
    if (retainedLink?.textContent?.trim() !== '查看历史缺口') throw new Error('纯历史规则缺口必须提供查看历史缺口入口')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__riskManagementSettingsBrowserTest = run()

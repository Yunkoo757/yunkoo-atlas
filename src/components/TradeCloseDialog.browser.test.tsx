import { createRoot } from 'react-dom/client'
import { DeferredTradeOverlays } from '@/components/DeferredTradeOverlays'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { useToast } from '@/lib/toast'
import { resolveTradeTruth, summarizeTradeResults } from '@/lib/tradeTruth'

declare global {
  interface Window {
    __tradeCloseDualMetricsTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function enterValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  assert(setter, '浏览器不支持输入框原生 setter')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const trade: Trade = {
  id: 'dual-metrics-close',
  ref: 'TRD-DUAL',
  symbol: 'EURUSD',
  side: 'long',
  status: 'open',
  conviction: 'medium',
  strategyId: 'uncategorized',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 0,
  exit: 1.2345,
  size: 0,
  pnl: null,
  rMultiple: null,
  openedAt: '2026-07-15',
  closedAt: null,
  note: '',
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  const returnFocus = document.createElement('button')
  returnFocus.textContent = '平仓触发入口'
  document.body.append(returnFocus)
  returnFocus.focus()

  try {
    useStore.setState({
      trades: [trade],
      closeTradeRequest: { tradeId: trade.id, returnFocus },
      undoStack: [],
      redoStack: [],
    })
    root.render(<DeferredTradeOverlays />)

    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), '平仓弹窗没有打开')
    const pnlInput = document.querySelector<HTMLInputElement>('input[aria-label="盈亏金额"]')
    const rInput = document.querySelector<HTMLInputElement>('input[aria-label="R 倍数"]')
    assert(pnlInput, '平仓时应同时显示盈亏金额输入框')
    assert(rInput, '平仓时应同时显示 R 倍数输入框')
    await waitFor(() => Boolean(document.querySelector('.trade-close-date-field .ui-date-trigger')), '平仓日期应加载统一日期选择器')
    assert(!document.querySelector('input[type="date"]'), '平仓弹窗不得打开系统原生日历')
    assert(!document.querySelector('input[aria-label="出场价"]'), '平仓不应再要求出场价')
    assert(!document.body.textContent?.includes('记录依据'), '平仓不应再显示价格记录方式')
    assert(!document.body.textContent?.includes('出场价格'), '平仓不应再提供出场价格模式')

    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '取消')?.click()
    await waitFor(() => useStore.getState().closeTradeRequest === null, '普通平仓弹窗的取消必须关闭请求')
    await waitFor(() => document.activeElement === returnFocus, '平仓弹窗关闭后必须归还焦点到显式触发入口')
    useStore.getState().requestTradeClose(trade.id)
    await waitFor(() => Boolean(document.querySelector('input[aria-label="盈亏金额"]')), '取消后必须能再次打开平仓弹窗')

    const submit = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '保存并待复盘')
    assert(submit, '缺少保存平仓按钮')
    assert(submit.disabled, '缺少盈亏金额和 R 倍数时主按钮必须禁用')

    const reopenedPnlInput = document.querySelector<HTMLInputElement>('input[aria-label="盈亏金额"]')
    const reopenedRInput = document.querySelector<HTMLInputElement>('input[aria-label="R 倍数"]')
    assert(reopenedPnlInput && reopenedRInput, '重开平仓弹窗后必须重新渲染结果输入框')
    const outcomes = document.querySelector('[role="radiogroup"][aria-label="交易结果"]')
    const win = outcomes?.querySelector<HTMLButtonElement>('[role="radio"][aria-label="盈利"]')
    const even = outcomes?.querySelector<HTMLButtonElement>('[role="radio"][aria-label="保本"]')
    const loss = outcomes?.querySelector<HTMLButtonElement>('[role="radio"][aria-label="亏损"]')
    const summary = document.getElementById('trade-close-summary')
    assert(win && even && loss && summary, '应同时显示三种平仓结果与输入反馈')
    assert(win.getAttribute('aria-checked') === 'true' && win.tabIndex === 0 && loss.tabIndex === -1, '结果组只有当前结果进入 Tab 顺序')
    assert([win, even, loss].every((option) => option.querySelector('[data-icon-motion="status"]')), '结果选项必须沿用列表、属性中的状态图标')

    await waitFor(() => document.activeElement === reopenedPnlInput, '平仓初始焦点应落在盈亏金额')
    win.focus()
    win.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await waitFor(() => document.activeElement === loss && loss.getAttribute('aria-checked') === 'true', '键盘应能从盈利切换到亏损')
    enterValue(reopenedPnlInput, '0')
    await waitFor(() => submit.disabled && reopenedPnlInput.getAttribute('aria-invalid') === 'true' && summary.getAttribute('role') === 'alert', '非保本零值要在输入项和邻近反馈中明确指出')
    enterValue(reopenedPnlInput, '25')
    enterValue(reopenedRInput, '1.5')
    await waitFor(() => !submit.disabled && Boolean(summary.textContent?.includes('-1.5R')), '亏损预览必须准确显示记录的负值')
    even.click()
    await waitFor(() => reopenedPnlInput.value === '-25' && reopenedRInput.value === '-1.5', '切到保本时必须保留已输入数据的方向')
    win.click()
    await waitFor(() => reopenedPnlInput.value === '25' && reopenedRInput.value === '1.5' && !submit.disabled, '切回盈利后数值和可提交状态应同步恢复')
    enterValue(reopenedPnlInput, '500')
    enterValue(reopenedRInput, '2')
    await waitFor(() => !submit.disabled, '填写有效结果后主按钮没有启用')
    submit.click()

    await waitFor(() => useStore.getState().closeTradeRequest === null, '平仓结果没有提交')
    const closed = useStore.getState().trades[0]
    assert(closed?.pnl === 500, '盈亏金额必须保存')
    assert(closed?.rMultiple === 2, 'R 倍数必须与金额同时保存')
    assert(closed?.exit === trade.exit, '平仓不得覆盖历史出场价兼容数据')

    const closeActionId = useStore.getState().undoStack.at(-1)?.actionId
    const oldToastAction = useToast.getState().onAction
    assert(closeActionId && oldToastAction, '平仓 Toast 必须捕获本次 actionId')
    useStore.getState().updateTradeData(trade.id, { openedAt: '2026-07-16' })
    const laterActionId = useStore.getState().undoStack.at(-1)?.actionId
    assert(laterActionId && laterActionId !== closeActionId, '后续字段编辑必须形成独立动作')

    oldToastAction()
    const restored = useStore.getState().trades[0]
    assert(restored?.status === 'open' && restored.pnl === null && restored.rMultiple === null, '旧 Toast 必须只撤销自己的平仓动作')
    assert(restored.openedAt === '2026-07-16', '旧 Toast 不得覆盖动作后的非 touched 字段')
    assert(useStore.getState().undoStack.some((action) => action.actionId === laterActionId), '旧 Toast 不得误撤新的栈顶动作')

    // 日期越过旧周期边界也必须直接保存，并保留显式 stage 归属。
    const archiveCandidate: Trade = {
      ...trade,
      tradeKind: 'live',
      id: 'close-to-archive',
      ref: 'TRD-ARCHIVE',
      liveStageId: previous.currentLiveStageId,
      openedAt: '2026-08-05',
      closedAt: '2026-07-01',
    }
    useStore.setState({
      trades: [archiveCandidate],
      closeTradeRequest: { tradeId: archiveCandidate.id },
      undoStack: [],
      redoStack: [],
      display: { ...previous.display, tradingDayStartHour: 0 },
    })
    root.render(<DeferredTradeOverlays />)
    await waitFor(() => document.body.textContent?.includes('TRD-ARCHIVE') ?? false, '迁移场景必须加载新交易')
    await waitFor(() => Boolean(document.querySelector('input[aria-label="盈亏金额"]')), '迁移场景平仓弹窗没有打开')
    const archivePnl = document.querySelector<HTMLInputElement>('input[aria-label="盈亏金额"]')
    assert(archivePnl, '迁移场景缺少盈亏金额输入')
    enterValue(archivePnl, '100')
    const archiveSubmit = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '保存并待复盘')
    assert(archiveSubmit, '迁移场景缺少提交按钮')
    await waitFor(() => !archiveSubmit.disabled, '迁移场景填写结果后提交按钮必须可用')
    archiveSubmit.click()
    await waitFor(() => useStore.getState().closeTradeRequest === null, '跨旧周期边界的日期编辑必须一次提交完成')
    assert(!document.body.textContent?.includes('归属将改变'), '普通日期编辑不得显示重新归属提示')
    assert(useStore.getState().trades[0]?.status === 'win', '保存后必须完成平仓')
    assert(useStore.getState().trades[0]?.closedTradingDayKey === '2026-07-01', '保存后必须更新平仓业务日事实')
    const savedArchiveCandidate = useStore.getState().trades[0]
    assert(savedArchiveCandidate?.tradeKind === 'live' && savedArchiveCandidate.liveStageId === previous.currentLiveStageId, '平仓日期编辑必须保留原 stage ID')

    const oldInstant = '2026-07-12T02:30:00+08:00'
    for (const closedAt of [oldInstant, '2026-02-30', '']) {
      const source: Trade = { ...trade, id: 'date-check', closedAt, closedTradingDayKey: '2026-07-11', rMultiple: 1.5 }
      useStore.setState({ trades: [source], closeTradeRequest: { tradeId: source.id, targetStatus: 'loss' } })
      await waitFor(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[aria-label="R 倍数"]')?.value === '1.5', '历史交易应载入原始 R')
      const date = document.querySelector<HTMLButtonElement>('[role="dialog"] .ui-date-trigger')!
      const save = document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!
      const feedback = document.getElementById('trade-close-summary')!
      if (closedAt === oldInstant) {
        assert(date.textContent?.trim() === '2026-07-11', '历史时刻应展示已有业务日')
      } else {
        assert(date.getAttribute('aria-invalid') === 'true' && save.disabled && feedback.textContent?.includes('平仓日期'), '旧日期无效时应标出日期并说明原因')
        date.click()
        await waitFor(() => Boolean(document.querySelector('.ui-date-today')), '无效日期应能打开日历修正')
        document.querySelector<HTMLButtonElement>('.ui-date-today')!.click()
      }
      await waitFor(() => !save.disabled && feedback.textContent?.trim() === '将记录 -1.5R', '只填 R 应只预览带签名的 R')
      const shownDate = date.textContent?.trim()
      save.click()
      await waitFor(() => useStore.getState().closeTradeRequest === null, '日期有效后应能提交')
      const stored = useStore.getState().trades[0]
      assert(stored.closedAt === (closedAt === oldInstant ? oldInstant : shownDate), '未重选日期须保留历史时刻，重选日期则保存所选日期')
      assert(stored.pnl === null && stored.rMultiple === -1.5, '单独 R 不得推算金额')
    }

    for (const amount of ['-2.5', '1.25', '']) {
      useStore.setState({ trades: [trade], closeTradeRequest: { tradeId: trade.id, targetStatus: 'breakeven' } })
      await waitFor(() => Boolean(document.querySelector('input[aria-label="盈亏金额"]')), '保本必须开放金额输入')
      const cash = document.querySelector<HTMLInputElement>('input[aria-label="盈亏金额"]')!
      const save = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '保存并待复盘')!
      assert(document.body.textContent?.includes('可正可负'), '保本必须提示使用正负数输入')
      enterValue(cash, '-')
      await waitFor(() => save.disabled && cash.getAttribute('aria-invalid') === 'true', '未完成的负数输入必须阻止保存')
      enterValue(cash, amount)
      await waitFor(() => !save.disabled, '有效保本金额及留空零必须可保存')
      save.click()
      await waitFor(() => useStore.getState().closeTradeRequest === null, '保本登记未完成')
      const saved = useStore.getState().trades[0]
      assert(saved.status === 'breakeven' && saved.pnl === Number(amount), '保本分类与实际金额必须保存')
      assert(resolveTradeTruth(saved).isResultComplete, '保本金额不得被统计视为冲突')
      assert(summarizeTradeResults([saved]).totalPnl === Number(amount), '保本实际金额必须进入汇总')
      useStore.getState().requestTradeClose(saved.id)
      await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="盈亏金额"]')?.value === String(Number(amount)), '重开保本弹窗必须保留金额正负号')
      ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '取消')?.click()
      await waitFor(() => useStore.getState().closeTradeRequest === null, '取消补录必须关闭弹窗')
      assert(useStore.getState().trades[0].pnl === Number(amount), '取消不得改动已存保本结果')
    }
  } finally {
    root.unmount()
    returnFocus.remove()
    useToast.getState().dismiss()
    useStore.setState({
      trades: previous.trades,
      closeTradeRequest: previous.closeTradeRequest,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
      display: previous.display,
    })
  }
}

window.__tradeCloseDualMetricsTest = run()

import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { MobileNavigation } from '@/components/MobileNavigation'
import { ToastHost } from '@/components/Toast'
import { AppFrame } from '@/components/ui/AppFrame'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { getTradingDayKey } from '@/lib/periods'
import type { SidebarWorkspaceItem } from '@/lib/sidebarWorkspace'
import { useStore } from '@/store/useStore'
import { DetailView } from '@/views/DetailView'
import { MissedOpportunitiesView } from '@/views/MissedOpportunitiesView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __missedOpportunitiesBrowserTest: Promise<void>
  }
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

async function assertLiveRegionStable(text: string, message: string): Promise<void> {
  const matches = () => document.querySelector<HTMLElement>('.missed-live')?.textContent?.includes(text) === true
  await waitFor(matches, `${message}：未等待到目标文案`)
  await frame()
  assert(matches(), `${message}：目标文案未跨至少一帧保持稳定`)
}

function scopeTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="管理包含范围"]')
  assert(trigger, '找不到包含范围入口')
  return trigger
}

async function ensureScopeOpen(): Promise<void> {
  if (document.querySelector('[role="menu"][aria-label="包含范围"]')) return
  keyboardActivate(scopeTrigger())
  await waitFor(
    () => document.querySelector('[role="menu"][aria-label="包含范围"]') !== null,
    '键盘 Enter 未打开包含范围',
  )
}

function scopeOption(label: string): HTMLButtonElement {
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')]
    .find((candidate) => candidate.textContent?.trim().startsWith(label))
  assert(option, `找不到范围选项：${label}`)
  return option
}

function routerLocation(): string {
  return document.querySelector('[data-router-location]')?.textContent ?? ''
}

function normalizedSearch(params: URLSearchParams): string {
  return JSON.stringify(
    [...params.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    )),
  )
}

function resultRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-trade-id="${CSS.escape(id)}"]`)
  assert(row, `找不到聚合行：${id}`)
  return row
}

function keyboardActivate(button: HTMLButtonElement): void {
  button.focus()
  assert(document.activeElement === button, '键盘动作必须先获得焦点')
  button.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  }))
  button.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  button.click()
}

function filterTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="筛选错过机会"]')
  assert(trigger, '找不到错过机会筛选入口')
  return trigger
}

async function ensureFilterOpen(): Promise<void> {
  if (document.querySelector('[aria-label="错过机会筛选"]')) return
  keyboardActivate(filterTrigger())
  await waitFor(
    () => document.querySelector('[aria-label="错过机会筛选"]') !== null,
    '键盘 Enter 未打开筛选器',
  )
}

async function selectFilter(label: string, value: string): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)
  assert(trigger, `找不到筛选字段：${label}`)
  trigger.click()
  await waitFor(
    () => document.querySelector(`[role="listbox"][aria-label="${label}"]:not(.ui-exit-clone)`) !== null,
    `筛选字段 ${label} 未打开`,
  )
  const options = [...document.querySelectorAll<HTMLButtonElement>(
    `[role="listbox"][aria-label="${label}"]:not(.ui-exit-clone) [role="option"]`,
  )]
  const option = options.find((candidate) => candidate.dataset.value === value)
  assert(option, `筛选字段 ${label} 缺少值 ${value}`)
  option.click()
  await waitFor(
    () => document.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)?.dataset.value === value,
    `筛选字段 ${label} 未更新到 ${value}`,
  )
}

async function returnFromDetail(anchorId: string): Promise<void> {
  const back = document.querySelector<HTMLAnchorElement>('[aria-label="返回错过的机会"]')
  assert(back, '详情页缺少返回错过的机会入口')
  back.click()
  await waitFor(() => routerLocation().startsWith('/missed'), '详情返回未恢复聚合页')
  await waitFor(
    () => document.activeElement?.closest('[data-trade-id]')?.getAttribute('data-trade-id') === anchorId,
    `详情返回未恢复聚合项焦点：${anchorId}`,
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output data-router-location>{location.pathname}{location.search}</output>
}

const strategy: Strategy = {
  id: 'browser-strategy',
  name: '浏览器策略',
  icon: 'target',
  color: '#5e6ad2',
}

const today = getTradingDayKey()

function missedTrade(
  id: string,
  ref: string,
  tradeKind: 'live' | 'paper',
  symbol: string,
  side: Trade['side'],
  missReason: NonNullable<Trade['missReason']>,
  openedAt: string,
): Trade {
  return {
    id,
    ref,
    symbol,
    side,
    status: 'missed',
    conviction: 'medium',
    strategyId: strategy.id,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind,
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    missReason,
    openedAt,
    closedAt: openedAt,
    note: '<p>浏览器错过机会 fixture</p>',
  }
}

function missedCase(
  id: string,
  ref: string,
  symbol: string,
  side: Trade['side'],
  missReason: NonNullable<Trade['missReason']>,
  recordedAt: string,
  sourceTradeId?: string,
): Trade {
  return {
    ...missedTrade(id, ref, 'live', symbol, side, missReason, recordedAt),
    tradeKind: 'case',
    caseType: 'missed',
    masteryState: 'new',
    nextReviewAt: null,
    recordedAt,
    sourceTradeId,
  }
}

const rootTrade = missedTrade(
  'live-root',
  'LIVE-001',
  'live',
  'XAUUSD',
  'long',
  'hesitation',
  `${today}T09:00:00`,
)
const paperTrade = missedTrade(
  'paper-standalone',
  'PAPER-001',
  'paper',
  'BTCUSDT',
  'short',
  'no_alert',
  `${today}T10:00:00`,
)
const linkedCaseOne = missedCase(
  'case-linked-one',
  'CAS-LINK-1',
  'XAUUSD',
  'long',
  'hesitation',
  `${today}T11:00:00`,
  rootTrade.id,
)
const linkedCaseTwo = missedCase(
  'case-linked-two',
  'CAS-LINK-2',
  'XAUUSD',
  'long',
  'hesitation',
  `${today}T12:00:00`,
  rootTrade.id,
)
const unlinkedCase = missedCase(
  'case-unlinked',
  'CAS-UNLINKED',
  'ETHUSDT',
  'short',
  'rule_break',
  `${today}T13:00:00`,
)
const deletedOrigin = {
  ...missedTrade(
    'deleted-origin',
    'LIVE-DELETED',
    'live',
    'USDJPY',
    'long',
    'other',
    `${today}T07:00:00`,
  ),
  deletedAt: `${today}T08:00:00`,
}
const survivingCase = missedCase(
  'case-surviving',
  'CAS-SURVIVING',
  'USDJPY',
  'long',
  'other',
  `${today}T08:30:00`,
  deletedOrigin.id,
)

const fixtureTrades: Trade[] = [
  rootTrade,
  paperTrade,
  linkedCaseOne,
  linkedCaseTwo,
  unlinkedCase,
  deletedOrigin,
  survivingCase,
]

const fillerTrades = Array.from({ length: 18 }, (_, index) => missedTrade(
  `filler-${index}`,
  `FILLER-${String(index).padStart(2, '0')}`,
  'live',
  'XAUUSD',
  'long',
  'hesitation',
  `${today}T14:${String(index).padStart(2, '0')}:00`,
))

const mobileLastTrade = missedTrade(
  'mobile-last',
  'MOBILE-LAST-WITH-A-LONG-REFERENCE',
  'paper',
  'AUDCAD-LONG-SYMBOL',
  'short',
  'missed_setup',
  '2000-01-01T00:00:00',
)

const visualFixtureTrades = [...fixtureTrades, ...fillerTrades, mobileLastTrade]

const missedWorkspace: SidebarWorkspaceItem = {
  id: 'system:missed',
  target: { kind: 'system', id: 'missed', workspaces: ['trade', 'paper', 'case'] },
  placement: 'pinned',
  order: 0,
}

function FixtureApp() {
  return (
    <AppFrame sidebar={null} mobileNavigation={<MobileNavigation />}>
      <Routes>
        <Route path="/missed" element={<MissedOpportunitiesView />} />
        <Route path="/trade/:id" element={<DetailView />} />
      </Routes>
      <LocationProbe />
      <ToastHost />
    </AppFrame>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  const visualMode = new URLSearchParams(window.location.search).get('visual') === 'mobile'
  let keepMounted = false
  sessionStorage.clear()

  try {
    useStore.setState({
      trades: visualMode ? visualFixtureTrades : fixtureTrades,
      strategies: [strategy],
      symbolCatalog: ['XAUUSD', 'BTCUSDT', 'ETHUSDT', 'USDJPY', 'NZDCHF', 'AUDCAD-LONG-SYMBOL'],
      display: {
        ...previous.display,
        sidebarWorkspaceItems: [missedWorkspace],
      },
    })
    root.render(
      <MemoryRouter initialEntries={['/missed']}>
        <FixtureApp />
      </MemoryRouter>,
    )

    await waitFor(
      () => document.querySelector('[data-trade-id="live-root"]') !== null,
      '聚合来源行未渲染',
    )
    if (visualMode) {
      keepMounted = true
      await frame()
      await frame()
      return
    }

    assert(document.querySelector('h1')?.textContent?.trim() === '错过的机会', '页面标题不准确')
    assert(document.querySelector('.ui-toolbar-context')?.textContent?.trim() === '跨工作区汇总', '页面副标题不准确')
    assert(document.querySelector('.missed-scope') === null, '不得保留常驻范围配置区')
    assert(document.querySelector('[data-missed-total]')?.textContent?.includes('全部机会 4'), '工具栏结果数不准确')
    assert(scopeTrigger().textContent?.trim() === '范围 · 3', '范围入口必须显示已启用来源数')
    await ensureScopeOpen()
    const scopeOptions = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')]
    assert(scopeOptions.length === 3, '必须渲染三个包含来源选项')
    assert(scopeOptions.every((button) => button.getAttribute('aria-checked') === 'true'), '三个来源初始必须全部启用')
    assert(scopeOption('交易日志').textContent?.includes('1'), '交易日志来源计数不准确')
    assert(scopeOption('模拟盘').textContent?.includes('1'), '模拟盘来源计数不准确')
    assert(scopeOption('案例记录').textContent?.includes('4'), '案例记录来源计数不准确')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await waitFor(() => document.querySelector('[role="menu"][aria-label="包含范围"]') === null, '外部点击未关闭范围菜单')
    await frame()
    assert(document.activeElement === scopeTrigger(), '外部点击关闭后焦点必须返回范围入口')
    await ensureScopeOpen()
    assert(document.body.textContent?.includes('跨工作区关联项已合并'), 'raw 大于主数时缺少合并说明')
    assert(document.querySelectorAll('[data-trade-id]').length === 4, '明确关联必须只渲染一个聚合行')
    assert(document.querySelector('[data-trade-id="case-linked-one"]') === null, 'linked case 不得重复渲染为独立行')
    assert(document.querySelector('[data-trade-id="case-linked-two"]') === null, '第二个 linked case 不得重复渲染为独立行')
    assert(document.querySelector('[data-trade-id="case-unlinked"]'), '未关联案例必须独立渲染')
    assert(resultRow('case-surviving').textContent?.includes('来源记录已删除'), '删除来源后的存活案例缺少状态')
    const mergedRow = resultRow(rootTrade.id)
    assert(mergedRow.classList.contains('is-merged'), '明确关联项缺少合并状态')
    assert(mergedRow.querySelector('.missed-row-actions')?.textContent?.includes('打开原始记录'), '合并项缺少原始记录动作')
    assert(mergedRow.querySelector('.missed-row-actions')?.textContent?.includes('打开案例（2）'), '合并项缺少案例动作')
    const multipleCaseTrigger = [...mergedRow.querySelectorAll<HTMLButtonElement>('.missed-row-actions button')]
      .find((button) => button.textContent?.trim() === '打开案例（2）')
    assert(
      multipleCaseTrigger?.getAttribute('aria-label') === '打开 XAUUSD 案例（2）',
      '桌面多案例菜单必须包含品种上下文',
    )

    useStore.setState({ trades: fixtureTrades.filter((trade) => trade.id !== linkedCaseTwo.id) })
    await waitFor(
      () => resultRow(rootTrade.id).querySelector('.missed-row-actions')?.textContent?.includes('打开案例') === true
        && resultRow(rootTrade.id).querySelector('.missed-row-actions')?.textContent?.includes('打开案例（2）') === false,
      '未进入单案例聚合状态',
    )
    const singleCaseRow = resultRow(rootTrade.id)
    const sourceAccessibleAction = singleCaseRow.querySelector<HTMLButtonElement>(
      '.missed-row-actions [data-trade-primary-action]',
    )
    assert(sourceAccessibleAction?.textContent?.trim() === '打开原始记录', '桌面原始记录动作可见文字必须保持简洁')
    assert(
      sourceAccessibleAction.getAttribute('aria-label') === '打开 XAUUSD 原始交易记录',
      '桌面原始记录动作必须包含品种上下文',
    )
    const singleCaseAction = [...singleCaseRow.querySelectorAll<HTMLButtonElement>('.missed-row-actions button')]
      .find((button) => button.textContent?.trim() === '打开案例')
    assert(singleCaseAction, '单案例聚合项缺少桌面案例动作')
    assert(singleCaseAction.textContent?.trim() === '打开案例', '桌面案例动作可见文字必须保持简洁')
    assert(
      singleCaseAction.getAttribute('aria-label') === '打开案例 CAS-LINK-1',
      '桌面单案例动作必须包含案例 ref 上下文',
    )

    const mobileMenuTrigger = singleCaseRow.querySelector<HTMLButtonElement>('.missed-row-mobile-menu button')
    assert(mobileMenuTrigger, '单案例聚合项缺少移动菜单')
    mobileMenuTrigger.click()
    await waitFor(() => document.querySelector('[role="menu"]') !== null, '移动菜单未打开')
    const mobileMenuLabels = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .map((button) => button.textContent?.trim())
    assert(
      mobileMenuLabels.includes('打开 XAUUSD 原始交易记录'),
      '移动菜单原始记录动作必须与桌面使用相同完整名称',
    )
    assert(
      mobileMenuLabels.includes('打开案例 CAS-LINK-1'),
      '移动菜单案例动作必须与桌面使用相同完整名称',
    )
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => document.querySelector('[role="menu"]') === null, '移动菜单未关闭')
    await ensureScopeOpen()

    useStore.setState({ trades: fixtureTrades })
    await waitFor(
      () => resultRow(rootTrade.id).querySelector('.missed-row-actions')?.textContent?.includes('打开案例（2）') === true,
      '完整 fixture 未恢复多案例聚合状态',
    )
    for (const source of document.querySelectorAll<HTMLElement>('.missed-row-source')) {
      assert(source.getAttribute('aria-hidden') !== 'true', '来源文字不得 aria-hidden')
      assert(source.closest('[aria-hidden="true"]') === null, '来源文字祖先不得 aria-hidden')
      assert(source.getClientRects().length > 0, '来源文字必须真实可见')
    }

    const originalPaper = useStore.getState().trades.find((trade) => trade.id === paperTrade.id)
    keyboardActivate(scopeOption('模拟盘'))
    await waitFor(() => document.querySelector('[data-trade-id="paper-standalone"]') === null, '关闭模拟盘后模拟行仍存在')
    assert(scopeOption('模拟盘').getAttribute('aria-checked') === 'false', '关闭模拟盘后 aria-checked 未更新')
    assert(useStore.getState().trades.find((trade) => trade.id === paperTrade.id) === originalPaper, '关闭来源不得修改 /sim 本地数据')
    keyboardActivate(scopeOption('模拟盘'))
    await waitFor(() => document.querySelector('[data-trade-id="paper-standalone"]') !== null, '重新启用模拟盘后结果未恢复')

    scopeOption('模拟盘').click()
    scopeOption('案例记录').click()
    await waitFor(
      () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')]
        .filter((button) => button.getAttribute('aria-checked') === 'true').length === 1,
      '未进入只保留一个来源的状态',
    )
    scopeOption('交易日志').click()
    assert(scopeOption('交易日志').getAttribute('aria-checked') === 'true', '最后一个来源不得关闭')
    await waitFor(
      () => document.querySelector('[role="status"]')?.textContent?.includes('至少保留一个工作区') === true,
      '最后来源保护缺少可见状态反馈',
    )
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => document.querySelector('[role="menu"][aria-label="包含范围"]') === null, 'Escape 未关闭范围菜单')
    await frame()
    assert(document.activeElement === scopeTrigger(), 'Escape 关闭后焦点必须返回范围入口')
    await ensureScopeOpen()
    scopeOption('模拟盘').click()
    scopeOption('案例记录').click()
    await waitFor(() => resultRow(rootTrade.id).classList.contains('is-merged'), '恢复案例来源后聚合项未恢复')

    useStore.setState({ trades: [] })
    await waitFor(
      () => document.querySelector('.missed-empty h2')?.textContent?.trim() === '所选工作区暂无错过记录',
      '所选来源无数据时必须进入来源空状态',
    )
    const sourceEmpty = document.querySelector<HTMLElement>('.missed-empty')
    assert(sourceEmpty, '来源空状态容器未渲染')
    assert(
      sourceEmpty.querySelector('p')?.textContent?.trim() === '可以前往已包含的工作区查看或补充原始记录。',
      '来源空状态缺少包含范围说明',
    )
    const emptySourceHrefs = () => [...document.querySelectorAll<HTMLAnchorElement>('.missed-empty a')]
      .map((link) => link.getAttribute('href'))
      .sort()
    assert(emptySourceHrefs().join(',') === '/list,/review-cases,/sim', '三来源空状态必须显示三个准确入口')

    scopeOption('模拟盘').click()
    await waitFor(() => scopeOption('模拟盘').getAttribute('aria-checked') === 'false', '来源空状态无法关闭模拟盘')
    assert(emptySourceHrefs().join(',') === '/list,/review-cases', '关闭模拟盘后空状态不得保留 /sim 入口')
    scopeOption('交易日志').click()
    await waitFor(() => scopeOption('交易日志').getAttribute('aria-checked') === 'false', '来源空状态无法关闭交易日志')
    assert(emptySourceHrefs().join(',') === '/review-cases', '仅保留案例来源时只能显示 /review-cases 入口')

    scopeOption('交易日志').click()
    scopeOption('模拟盘').click()
    useStore.setState({ trades: fixtureTrades })
    await waitFor(
      () => document.querySelector(`[data-trade-id="${rootTrade.id}"]`)?.classList.contains('is-merged') === true,
      '来源空状态后聚合结果未恢复',
    )
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => document.querySelector('[role="menu"][aria-label="包含范围"]') === null, '来源交互后范围菜单未关闭')

    await ensureFilterOpen()
    await selectFilter('品种', 'XAUUSD')
    await selectFilter('方向', 'long')
    await selectFilter('时间', 'today')
    await selectFilter('错过原因', 'hesitation')
    await waitFor(() => document.querySelector('[data-missed-total]')?.getAttribute('data-missed-total') === '1', '四类筛选未得到唯一结果')
    const filteredParams = new URLSearchParams(routerLocation().split('?')[1] ?? '')
    assert(
      [...filteredParams.keys()].sort().join(',') === 'missReason,period,side,symbol',
      '临时筛选 URL 只能包含四个允许键',
    )
    assert(document.querySelector('.missed-live')?.textContent?.trim() === '当前显示 1 条错过机会', '筛选后 live region 数量不准确')
    await selectFilter('品种', 'NZDCHF')
    await waitFor(() => document.body.textContent?.includes('没有符合当前筛选的机会') ?? false, '零结果筛选缺少空状态')
    const emptyClear = document.querySelector<HTMLButtonElement>('.missed-empty button')
    assert(emptyClear?.textContent?.trim() === '清除筛选', '筛选空状态缺少清除动作')
    emptyClear.click()
    await waitFor(() => routerLocation() === '/missed', '清除筛选未移除 URL 查询串')
    await waitFor(() => document.querySelector('[data-missed-total]')?.getAttribute('data-missed-total') === '4', '清除筛选未恢复全部结果')
    if (filterTrigger().getAttribute('aria-expanded') === 'true') filterTrigger().click()
    await waitFor(() => document.querySelector('[aria-label="错过机会筛选"]') === null, '清除后筛选面板未关闭')

    const paperRow = resultRow(paperTrade.id)
    const paperSummary = paperRow.querySelector<HTMLElement>('.missed-row-summary')
    const paperOverlay = paperRow.querySelector<HTMLButtonElement>('[data-trade-primary-action]')
    assert(paperSummary && paperOverlay, '普通项缺少整行覆盖动作')
    const summaryRect = paperSummary.getBoundingClientRect()
    const hit = document.elementFromPoint(summaryRect.left + summaryRect.width / 2, summaryRect.top + summaryRect.height / 2)
    assert(hit?.closest('[data-trade-primary-action]') === paperOverlay, '普通项文字区域点击必须命中整行覆盖动作')
    keyboardActivate(paperOverlay)
    await waitFor(() => routerLocation() === '/trade/PAPER-001', '普通模拟项未进入自身详情')
    await returnFromDetail(paperTrade.id)

    const mergedSummary = resultRow(rootTrade.id).querySelector<HTMLElement>('.missed-row-summary')
    assert(mergedSummary, '合并项缺少摘要区域')
    const mergedSummaryRect = mergedSummary.getBoundingClientRect()
    const mergedHit = document.elementFromPoint(
      mergedSummaryRect.left + mergedSummaryRect.width / 2,
      mergedSummaryRect.top + mergedSummaryRect.height / 2,
    )
    assert(mergedHit instanceof HTMLElement, '合并项摘要坐标未命中 HTML 元素')
    const mergedHitIsSummary = mergedSummary.contains(mergedHit)
    const mergedHitIsAction = mergedHit.closest('button, a, [role="button"]') !== null
    mergedHit.click()
    await frame()
    assert(mergedHitIsSummary && !mergedHitIsAction, '合并项摘要坐标必须命中非动作内容')
    assert(routerLocation() === '/missed', '点击合并项非动作内容不得猜测导航目标')

    const sourceAction = resultRow(rootTrade.id).querySelector<HTMLButtonElement>(
      '.missed-row-actions [data-trade-primary-action]',
    )
    assert(sourceAction, '聚合来源缺少打开原始记录动作')
    keyboardActivate(sourceAction)
    await waitFor(
      () => routerLocation() === '/trade/LIVE-001',
      '桌面原始记录动作未进入准确目标',
    )
    await returnFromDetail(rootTrade.id)

    for (const reviewCase of [linkedCaseOne, linkedCaseTwo]) {
      const caseTrigger = [...resultRow(rootTrade.id).querySelectorAll<HTMLButtonElement>('.missed-row-actions button')]
        .find((button) => button.textContent?.trim() === '打开案例（2）')
      assert(caseTrigger, '桌面合并项缺少多案例菜单')
      keyboardActivate(caseTrigger)
      await waitFor(() => document.querySelector('[role="menu"]') !== null, '键盘未打开多案例菜单')
      const menuItem = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((button) => button.textContent?.trim() === `打开案例 ${reviewCase.ref}`)
      assert(menuItem, `多案例菜单缺少准确目标：${reviewCase.ref}`)
      keyboardActivate(menuItem)
      await waitFor(() => routerLocation() === `/trade/${reviewCase.ref}`, `案例动作未进入 ${reviewCase.ref}`)
      await returnFromDetail(rootTrade.id)
    }

    useStore.setState({ trades: [...fixtureTrades, ...fillerTrades] })
    await waitFor(() => document.querySelector('[data-missed-total]')?.getAttribute('data-missed-total') === '22', '滚动 fixture 未进入聚合结果')
    await ensureFilterOpen()
    await selectFilter('品种', 'XAUUSD')
    await selectFilter('方向', 'long')
    await selectFilter('时间', 'today')
    await selectFilter('错过原因', 'hesitation')
    const expectedReturnFilters = new URLSearchParams({
      period: 'today',
      symbol: 'XAUUSD',
      side: 'long',
      missReason: 'hesitation',
    })
    const returnFiltersBeforeDetail = new URLSearchParams(routerLocation().split('?')[1] ?? '')
    assert(
      normalizedSearch(returnFiltersBeforeDetail) === normalizedSearch(expectedReturnFilters),
      '进入详情前 URL 必须准确包含四类筛选键值',
    )
    if (filterTrigger().getAttribute('aria-expanded') === 'true') filterTrigger().click()
    const content = document.querySelector<HTMLElement>('.missed-content')
    assert(content, '聚合列表缺少滚动容器')
    content.scrollTop = content.scrollHeight
    content.dispatchEvent(new Event('scroll'))
    await waitFor(() => document.querySelector('[data-trade-id="live-root"]') !== null, '滚动到底部后根聚合项未渲染')
    assert(content.scrollTop > 0, '滚动 fixture 未形成非零现场')
    const scrolledSourceAction = resultRow(rootTrade.id).querySelector<HTMLButtonElement>(
      '.missed-row-actions [data-trade-primary-action]',
    )
    assert(scrolledSourceAction, '滚动聚合项缺少原始记录动作')
    scrolledSourceAction.click()
    await waitFor(() => routerLocation() === '/trade/LIVE-001', '滚动现场未进入详情')
    await returnFromDetail(rootTrade.id)
    const restoredParams = new URLSearchParams(routerLocation().split('?')[1] ?? '')
    assert(
      normalizedSearch(restoredParams) === normalizedSearch(returnFiltersBeforeDetail),
      '详情返回必须完整恢复 period、symbol、side、missReason 四类筛选键值',
    )
    assert(document.querySelector<HTMLElement>('.missed-content')?.scrollTop! > 0, '详情返回必须恢复滚动现场')

    await ensureFilterOpen()
    const panelClear = document.querySelector<HTMLButtonElement>('.missed-filter-clear')
    assert(panelClear, '筛选面板缺少清除动作')
    panelClear.click()
    await waitFor(() => routerLocation() === '/missed', '滚动现场清除筛选失败')
    if (filterTrigger().getAttribute('aria-expanded') === 'true') filterTrigger().click()

    const resetContent = document.querySelector<HTMLElement>('.missed-content')
    assert(resetContent, '清除筛选后滚动容器丢失')
    resetContent.scrollTop = 0
    resetContent.dispatchEvent(new Event('scroll'))
    await waitFor(() => document.querySelector('[data-trade-id="filler-17"]') !== null, '顶部普通项未渲染')
    const missingFilterTarget = resultRow('filler-17').querySelector<HTMLButtonElement>('[data-trade-primary-action]')
    assert(missingFilterTarget, '临时筛选 fallback 目标缺少动作')
    missingFilterTarget.click()
    await waitFor(() => routerLocation() === '/trade/FILLER-17', '临时筛选 fallback 目标未进入详情')
    useStore.getState().removeTrade('filler-17')
    document.querySelector<HTMLAnchorElement>('[aria-label="返回错过的机会"]')?.click()
    await waitFor(() => document.activeElement?.getAttribute('id') === 'missed-results-heading', '目标删除返回必须聚焦结果标题')
    await assertLiveRegionStable(
      '原记录已变化，已返回错过的机会列表',
      '目标删除返回必须说明结果变化',
    )
    await ensureFilterOpen()
    await selectFilter('品种', 'BTCUSDT')
    await waitFor(
      () => document.querySelector<HTMLElement>('.missed-live')?.textContent?.startsWith('当前显示 ') === true,
      '下一次临时筛选结果变化后 aria-live 必须恢复当前数量播报',
    )
    document.querySelector<HTMLButtonElement>('.missed-filter-clear')?.click()
    await waitFor(() => routerLocation() === '/missed', 'fallback 后清除临时筛选失败')
    if (filterTrigger().getAttribute('aria-expanded') === 'true') filterTrigger().click()

    const finalContent = document.querySelector<HTMLElement>('.missed-content')
    assert(finalContent, '来源 fallback 前滚动容器丢失')
    finalContent.scrollTop = finalContent.scrollHeight
    finalContent.dispatchEvent(new Event('scroll'))
    await waitFor(() => document.querySelector('[data-trade-id="paper-standalone"]') !== null, '来源 fallback 目标未渲染')
    const missingSourceTarget = resultRow(paperTrade.id).querySelector<HTMLButtonElement>('[data-trade-primary-action]')
    assert(missingSourceTarget, '来源 fallback 目标缺少动作')
    missingSourceTarget.click()
    await waitFor(() => routerLocation() === '/trade/PAPER-001', '来源 fallback 目标未进入详情')
    useStore.getState().removeTrade(paperTrade.id)
    await waitFor(
      () => document.querySelector<HTMLAnchorElement>('[aria-label="返回错过的机会"]') !== null,
      '删除目标后详情返回入口丢失',
    )
    document.querySelector<HTMLAnchorElement>('[aria-label="返回错过的机会"]')?.click()
    await waitFor(
      () => document.activeElement?.getAttribute('id') === 'missed-results-heading',
      '返回锚点消失后必须聚焦结果标题',
    )
    await assertLiveRegionStable(
      '原记录已变化，已返回错过的机会列表',
      '返回锚点消失后必须播报结果变化',
    )

    await ensureScopeOpen()
    scopeOption('案例记录').click()
    await assertLiveRegionStable('已更新包含范围：', '来源结果变化后 aria-live 必须说明新的包含范围')
  } finally {
    if (!keepMounted) {
      root.unmount()
      useStore.setState({
        trades: previous.trades,
        strategies: previous.strategies,
        symbolCatalog: previous.symbolCatalog,
        display: previous.display,
      })
    }
  }
}

window.__missedOpportunitiesBrowserTest = run()

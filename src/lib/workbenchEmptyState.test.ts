import {
  getWorkbenchResetPath,
  resolveWorkbenchEmptyState,
  shouldResetWorkbenchHideClosed,
} from '@/lib/workbenchEmptyState'
import type { Trade } from '@/data/trades'

export function testFirstUseHasOnePrimaryAction(): void {
  const state = resolveWorkbenchEmptyState({
    totalCount: 0,
    workspaceCount: 0,
    visibleCount: 0,
    recordKind: 'live',
  })

  if (!state) throw new Error('空资料库必须返回空状态模型')
  if (state.primaryAction.id !== 'create-trade') {
    throw new Error('首次使用必须只有一个新建交易主动作')
  }
  const secondaryIds = state.secondaryActions.map((item) => item.id)
  if (secondaryIds.join(',') !== 'import-backup,configure-strategy') {
    throw new Error(`首次使用次动作顺序错误：${secondaryIds.join(',')}`)
  }
}

const closedTrade: Trade = {
  id: 'closed-1',
  ref: 'TRD-1',
  symbol: 'EURUSD',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 1.1,
  exit: 1.11,
  stopLoss: 1.095,
  size: 1,
  pnl: 100,
  rMultiple: null,
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '',
}

export function testEmptyLibraryInvitesCreatingTheFirstRecord(): void {
  const state = resolveWorkbenchEmptyState({
    totalCount: 0,
    workspaceCount: 0,
    visibleCount: 0,
    recordKind: 'live',
  })

  if (state?.kind !== 'library' || state.action !== 'create') {
    throw new Error('An empty library must invite creating the first record')
  }
  if (state.title !== '还没有任何记录') {
    throw new Error('An empty library needs distinct copy from an empty filter result')
  }
  if (
    state.actionLabel !== '新建交易' ||
    !state.hint.includes('导入备份') ||
    !state.hint.includes('配置策略')
  ) {
    throw new Error('An empty library must expose the three first-use recovery paths')
  }
}

export function testEmptyLibraryCreationMatchesTheCurrentWorkspace(): void {
  const cases = resolveWorkbenchEmptyState({
    totalCount: 0,
    workspaceCount: 0,
    visibleCount: 0,
    recordKind: 'case',
  })
  const paper = resolveWorkbenchEmptyState({
    totalCount: 0,
    workspaceCount: 0,
    visibleCount: 0,
    recordKind: 'paper',
  })

  if (cases?.actionLabel !== '新建案例记录' || paper?.actionLabel !== '新建模拟盘记录') {
    throw new Error('空资料库的主操作必须沿用当前工作区的记录语义')
  }
}

export function testEmptyWorkspaceInvitesCreatingTheRelevantRecordKind(): void {
  const state = resolveWorkbenchEmptyState({
    totalCount: 3,
    workspaceCount: 0,
    visibleCount: 0,
    recordKind: 'case',
  })

  if (state?.kind !== 'workspace' || state.action !== 'create') {
    throw new Error('A library without records in this workspace must keep the create action')
  }
  if (state.title !== '当前工作区暂无案例记录') {
    throw new Error('The workspace empty state must name the relevant record kind')
  }
}

export function testFilteredEmptyStateOffersARecoveryPath(): void {
  const state = resolveWorkbenchEmptyState({
    totalCount: 8,
    workspaceCount: 5,
    visibleCount: 0,
    recordKind: 'live',
  })

  if (state?.kind !== 'filtered' || state.action !== 'reset') {
    throw new Error('Existing records hidden by conditions must offer a reset action')
  }
  if (!state.hint.includes('筛选') || !state.hint.includes('显示偏好')) {
    throw new Error('The recovery copy must explain both filtering and display preferences')
  }
  if (state.primaryAction.id !== 'clear-filters' || state.primaryAction.label !== '清除筛选') {
    throw new Error('Filtered empty states must offer one explicit filter reset action')
  }
}

export function testNonEmptyViewDoesNotRenderAnEmptyState(): void {
  const state = resolveWorkbenchEmptyState({
    totalCount: 8,
    workspaceCount: 5,
    visibleCount: 1,
    recordKind: 'live',
  })

  if (state !== null) {
    throw new Error('A non-empty view must not render an empty state')
  }
}

export function testResetPathClearsConditionsButKeepsTheCurrentLayout(): void {
  const legacyCaseTablePath = getWorkbenchResetPath('/review-cases/mistakes/table', 'case')
  const liveBoardPath = getWorkbenchResetPath('/strategy/navigation-1/board', 'live')

  if (legacyCaseTablePath !== '/review-cases') {
    throw new Error('Legacy table paths must reset into the canonical case list')
  }
  if (liveBoardPath !== '/board') {
    throw new Error('Reset must keep the board layout while returning to all trades')
  }
}

export function testCaseResetNeverChangesTheGlobalHideClosedPreference(): void {
  const shouldReset = shouldResetWorkbenchHideClosed({
    hideClosed: true,
    trades: [{ ...closedTrade, tradeKind: 'case' }],
    filter: { type: 'all', tradeKind: 'case' },
    starredIds: [],
    search: '',
  })

  if (shouldReset) {
    throw new Error('case records do not use hideClosed, so their reset must preserve the preference')
  }
}

export function testMissedResetNeverChangesTheGlobalHideClosedPreference(): void {
  const shouldReset = shouldResetWorkbenchHideClosed({
    hideClosed: true,
    trades: [{ ...closedTrade, status: 'missed' }],
    filter: { type: 'missed', tradeKind: 'live' },
    starredIds: [],
    search: '',
  })

  if (shouldReset) {
    throw new Error('the missed workspace bypasses hideClosed and must preserve the preference')
  }
}

export function testResetClearsHideClosedOnlyWhenItHidesAMatchingTrade(): void {
  const shouldReset = shouldResetWorkbenchHideClosed({
    hideClosed: true,
    trades: [closedTrade],
    filter: { type: 'all', tradeKind: 'live' },
    starredIds: [],
    search: '?symbol=EURUSD',
  })
  const unrelatedClosed = shouldResetWorkbenchHideClosed({
    hideClosed: true,
    trades: [closedTrade],
    filter: { type: 'all', tradeKind: 'live' },
    starredIds: [],
    search: '?symbol=BTCUSDT',
  })

  if (!shouldReset) {
    throw new Error('reset should reveal a closed trade hidden in the current filtered workspace')
  }
  if (unrelatedClosed) {
    throw new Error('reset must preserve hideClosed when no matching trade is hidden by it')
  }
}

export function testExplicitClosedStatusDoesNotResetHideClosed(): void {
  const shouldReset = shouldResetWorkbenchHideClosed({
    hideClosed: true,
    trades: [closedTrade],
    filter: { type: 'all', tradeKind: 'live' },
    starredIds: [],
    search: '?status=win&symbol=BTCUSDT',
  })

  if (shouldReset) {
    throw new Error('an explicit closed status already bypasses hideClosed and must preserve the preference')
  }
}

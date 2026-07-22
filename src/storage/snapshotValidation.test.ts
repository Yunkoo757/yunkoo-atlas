import {
  assertValidPersistedSnapshot,
  isValidPersistedTrade,
} from '@/storage/snapshotValidation'
import { buildWeeklyReviewMetrics, createWeeklyReview } from '@/data/weeklyReviews'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const valid = {
  trades: [{
    id: 'trade-1', ref: 'TRD-1', symbol: 'BTCUSDT', side: 'long', status: 'open',
    conviction: 'medium', strategyId: 'strategy-1', tags: [], mistakeTags: [],
    tradeKind: 'live', entry: 100, exit: null, size: 1, pnl: null, rMultiple: null,
    openedAt: '2026-07-14', closedAt: null, note: '',
  }],
  strategies: [{ id: 'strategy-1', name: '趋势', icon: 'trending-up', color: '#5e6ad2' }],
  starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
}

export function testSnapshotValidationAcceptsOpenTradesAndLegacyOptionalFields(): void {
  assertValidPersistedSnapshot(valid)
  const legacy = { ...valid, trades: valid.trades.map(({ tradeKind: _tradeKind, mistakeTags: _mistakes, ...trade }) => trade) }
  assertValidPersistedSnapshot(legacy)
}

export function testSnapshotValidationAcceptsLegacyWeeklyMetricsAndRejectsMalformedExecutionGaps(): void {
  const review = {
    ...createWeeklyReview('2026-07-13'),
    metricsSnapshot: buildWeeklyReviewMetrics([]),
  }
  const legacyMetrics: Record<string, unknown> = { ...review.metricsSnapshot }
  delete legacyMetrics.missedCount
  delete legacyMetrics.missedReasonCounts
  assertValidPersistedSnapshot({
    ...valid,
    weeklyReviews: [{ ...review, metricsSnapshot: legacyMetrics }],
  })

  for (const metricsPatch of [
    { missedCount: '1' },
    { missedReasonCounts: { hesitation: '1' } },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({
        ...valid,
        weeklyReviews: [{
          ...review,
          metricsSnapshot: { ...review.metricsSnapshot, ...metricsPatch },
        }],
      })
    } catch {
      rejected = true
    }
    assert(rejected, '损坏的执行缺口统计不得进入资料库快照')
  }
}

export function testSnapshotValidationRejectsMalformedTradeAndSettingsData(): void {
  let rejectedTrade = false
  try {
    assertValidPersistedSnapshot({ ...valid, trades: [{ ...valid.trades[0], entry: '100' }] })
  } catch {
    rejectedTrade = true
  }
  assert(rejectedTrade, '字符串价格不得进入资料库快照')

  let rejectedSettings = false
  try {
    assertValidPersistedSnapshot({ ...valid, starredIds: ['trade-1', 2] })
  } catch {
    rejectedSettings = true
  }
  assert(rejectedSettings, '损坏的设置数组不得进入资料库快照')
}

export function testSnapshotValidationRequiresRuntimeIdCollections(): void {
  for (const field of ['starredIds', 'subscribedIds', 'pinnedStrategyIds']) {
    const candidate: Record<string, unknown> = { ...valid }
    delete candidate[field]
    let rejected = false
    try {
      assertValidPersistedSnapshot(candidate)
    } catch {
      rejected = true
    }
    assert(rejected, `缺少 ${field} 时不得把快照提升为可运行状态`)
  }
}

export function testSnapshotValidationRejectsMissingRuntimeFieldsAndMalformedHistory(): void {
  for (const tradePatch of [
    { tags: undefined },
    { note: undefined },
    { comments: [{ id: 'comment-1', text: 42, createdAt: '2026-07-14' }] },
    { activities: [{ id: 'activity-1', kind: 'unknown', timestamp: '2026-07-14' }] },
    { activities: [{ id: 'activity-1', kind: 'status', timestamp: '2026-07-14', status: 'unknown' }] },
    { session: 42 },
    { timeframe: {} },
    { caseType: 'unknown' },
    { masteryState: 'learning' },
    { missReason: 'forgot' },
    { nextReviewAt: 20260720 },
    { deletedAt: false },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({
        ...valid,
        trades: [{ ...valid.trades[0], ...tradePatch }],
      })
    } catch {
      rejected = true
    }
    assert(rejected, '会破坏列表、搜索或活动流的畸形字段不得进入资料库')
  }
}

export function testSnapshotValidationRejectsMalformedDisplaySettings(): void {
  for (const display of [
    { hideClosed: 'false' },
    { sortBy: 'profit' },
    { sidebarPins: ['active', 2] },
    { sidebarWorkspaceItems: [{ id: 'broken' }] },
    { workspaceMemory: { trade: { pathname: 42 } } },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({ ...valid, display })
    } catch {
      rejected = true
    }
    assert(rejected, '完整恢复不得静默吞掉畸形显示设置')
  }
}

export function testSnapshotValidationAcceptsLegacyQuickViewSidebarPins(): void {
  assertValidPersistedSnapshot({
    ...valid,
    display: {
      sidebarWorkspaceItems: [
        {
          id: 'quick-view:paper:missed',
          target: { kind: 'quick-view', workspace: 'paper', view: 'missed' },
          placement: 'pinned',
          order: 0,
        },
        {
          id: 'system:missed',
          target: { kind: 'system', id: 'missed', workspaces: ['trade', 'case'] },
          placement: 'pinned',
          order: 1,
        },
      ],
    },
  })
}

export function testSnapshotValidationChecksResultAuthorityAndInitialRisk(): void {
  assertValidPersistedSnapshot({
    ...valid,
    trades: [{
      ...valid.trades[0],
      status: 'win',
      resultSource: 'price',
      exit: 110,
      initialStopLoss: 95,
      rMultiple: 2,
    }],
  })

  for (const tradePatch of [
    { resultSource: 'guessed' },
    { initialStopLoss: '95' },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({
        ...valid,
        trades: [{ ...valid.trades[0], ...tradePatch }],
      })
    } catch {
      rejected = true
    }
    assert(rejected, 'invalid result metadata must not enter a snapshot')
  }
}

export function testSnapshotValidationEnforcesDeclaredResultAuthorityMetrics(): void {
  const assertTradeAccepted = (tradePatch: Record<string, unknown>) => {
    assertValidPersistedSnapshot({
      ...valid,
      trades: [{ ...valid.trades[0], status: 'win', ...tradePatch }],
    })
  }
  const assertTradeRejected = (tradePatch: Record<string, unknown>) => {
    let rejected = false
    try {
      assertTradeAccepted(tradePatch)
    } catch {
      rejected = true
    }
    assert(rejected, 'declared authority must match its authoritative metric combination')
  }

  assertTradeAccepted({ pnl: 10, rMultiple: null, resultSource: 'pnl' })
  assertTradeAccepted({ pnl: null, rMultiple: 2, resultSource: 'r' })
  assertTradeAccepted({
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    exit: 110,
    initialStopLoss: 95,
  })
  assertTradeAccepted({ pnl: 10, rMultiple: 2, resultSource: 'imported' })
  assertTradeAccepted({ pnl: 10, rMultiple: 2, resultSource: undefined })

  assertTradeRejected({ pnl: null, rMultiple: 2, resultSource: 'pnl' })
  assertTradeRejected({ pnl: 10, rMultiple: 2, resultSource: 'pnl' })
  assertTradeRejected({ pnl: 10, rMultiple: null, resultSource: 'r' })
  assertTradeRejected({ pnl: 10, rMultiple: 2, resultSource: 'price' })
  assertTradeRejected({ pnl: null, rMultiple: 2, resultSource: 'price', exit: null })
  assertTradeRejected({
    pnl: null,
    rMultiple: 3,
    resultSource: 'price',
    exit: 110,
    initialStopLoss: 95,
  })
  assertTradeRejected({ pnl: 10, rMultiple: null, resultSource: 'imported' })
}

export function testSnapshotValidationExportsReusableTradeValidation(): void {
  assert(isValidPersistedTrade(valid.trades[0]), '共享 Trade 校验应接受有效持久化记录')
  assert(
    !isValidPersistedTrade({ ...valid.trades[0], comments: [{ id: 'c-1', text: 2, createdAt: 'now' }] }),
    '共享 Trade 校验应拒绝会破坏评论流的数据',
  )
}

export function testSnapshotValidationRejectsDuplicateEntityIds(): void {
  for (const candidate of [
    { ...valid, trades: [valid.trades[0], { ...valid.trades[0], ref: 'TRD-2' }] },
    { ...valid, strategies: [valid.strategies[0], { ...valid.strategies[0], name: '重复策略' }] },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot(candidate)
    } catch {
      rejected = true
    }
    assert(rejected, '重复的交易或策略 ID 不得进入资料库')
  }
}

export function testSnapshotValidationCoversWorkflowMetadataStructures(): void {
  assertValidPersistedSnapshot({
    ...valid,
    shortcuts: {
      'nav.list': { mod: true, key: 'l' },
      'nav.sequence': [{ key: 'g' }, { shift: true, key: 'l' }],
      'nav.disabled': null,
    },
    profile: {
      avatarId: null,
      displayName: 'Yunkoo',
      customAvatarDataUrl: null,
    },
    savedTradeViews: [{
      id: 'view-1',
      name: '待复盘',
      pathname: '/list',
      search: { reviewStatus: 'unreviewed' },
      pinned: true,
      order: 0,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }],
    symbolCatalog: ['BTCUSDT'],
    symbolIcons: {
      BTCUSDT: { presetId: 'btc', customDataUrl: null, updatedAt: '2026-07-16' },
    },
  })

  for (const patch of [
    { shortcuts: { 'nav.list': { key: 42 } } },
    { shortcuts: { 'nav.list': [] } },
    { profile: { displayName: 'Yunkoo' } },
    { savedTradeViews: [{ id: 'view-1', name: '坏视图', pathname: '/list', search: { status: 2 }, pinned: true, order: 0, createdAt: 'now', updatedAt: 'now' }] },
    { symbolCatalog: ['BTCUSDT', 42] },
    { symbolIcons: { BTCUSDT: { presetId: 'btc', updatedAt: 42 } } },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({ ...valid, ...patch })
    } catch {
      rejected = true
    }
    assert(rejected, '损坏的快捷键、资料、视图或品种设置不得进入恢复流程')
  }
}

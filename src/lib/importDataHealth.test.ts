import type { Trade } from '@/data/trades'
import {
  buildCopiedCloseDateCandidates,
  commitCopiedCloseDateCleanup,
  commitCopiedCloseDateCleanupThroughBoundary,
} from '@/lib/importDataHealth'
import { filterLivePerformanceRecords, resolveLiveArchiveScope } from '@/lib/liveStatisticsArchive'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import type { PersistedSnapshot, PersistedTrade } from '@/storage/types'
import { applyUndoAction, buildUndoAction, undoValuesEqual } from '@/lib/tradeUndo'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function trade(id: string, overrides: Partial<PersistedTrade> = {}): PersistedTrade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: '2025-11-03',
    closedAt: '2025-11-03',
    closedTradingDayKey: '2025-11-03',
    note: '',
    ...overrides,
  }
}

function snapshot(trades: PersistedTrade[]): PersistedSnapshot {
  return { ...createEmptyPersistedSnapshot(), trades }
}

export function testCandidatesRequireNotionAndSameLegalBusinessDay(): void {
  const high = trade('high', {
    importProvenance: {
      source: 'notion',
      importedAt: '2025-11-04T00:00:00.000Z',
      openedAtSource: 'notion-date',
      closedAtSource: 'missing-in-source',
    },
  })
  const weak = trade('weak', { tags: ['notion-import'] })
  const manualSameDay = trade('manual')
  const invalidDay = trade('invalid', {
    tags: ['notion-import'],
    openedAt: '2025-02-30',
    closedAt: '2025-02-30',
    closedTradingDayKey: undefined,
  })
  const nonTerminal = trade('open', { status: 'open', closedTradingDayKey: undefined })
  const differentDay = trade('different', {
    tags: ['notion-import'],
    closedAt: '2025-11-04',
    closedTradingDayKey: '2025-11-04',
  })

  const candidates = buildCopiedCloseDateCandidates(
    [high, weak, manualSameDay, invalidDay, nonTerminal, differentDay],
    6,
  )

  assert(candidates.length === 2, '只应列出具有 Notion 来源证据且同一合法业务日的终态记录')
  assert(candidates[0]?.tradeId === 'high' && candidates[0].confidence === 'high', '显式缺少来源平仓日证据应为高置信')
  assert(candidates[0]?.selectedByDefault === true, '只有高置信记录可默认选中')
  assert(candidates[1]?.tradeId === 'weak' && candidates[1].confidence === 'manual-review', '旧标签证据只能进入人工核对')
  assert(candidates[1]?.selectedByDefault === false, '证据不足记录必须默认不选中')
}

export function testRealSameDayCloseIsNeverAutomaticWithoutOpenedOnlyEvidence(): void {
  const candidate = buildCopiedCloseDateCandidates([
    trade('real-same-day', {
      importProvenance: {
        source: 'notion',
        importedAt: '2025-11-04T00:00:00.000Z',
        openedAtSource: 'notion-date',
        closedAtSource: 'notion-close-date',
      },
    }),
  ], 6)[0]

  assert(candidate?.confidence === 'manual-review', '真实 Notion 平仓日不得判为高置信污染')
  assert(candidate.selectedByDefault === false, '真实同日开平不得自动选中')
}

export async function testCleanupPersistsBeforePublishingAndUndoPatchRestoresExactFields(): Promise<void> {
  const original = trade('cleanup', {
    importProvenance: {
      source: 'notion',
      importedAt: '2025-11-04T00:00:00.000Z',
      openedAtSource: 'notion-date',
      closedAtSource: 'missing-in-source',
    },
  })
  const baseline = snapshot([original])
  const events: string[] = []
  let published: Trade[] | null = null
  const result = await commitCopiedCloseDateCleanup({
    tradeIds: ['cleanup'],
    tradingDayStartHour: 6,
    captureLatest: () => ({ trades: [original], snapshot: baseline }),
    persistSnapshot: async (candidate) => {
      events.push('persist')
      assert(candidate.trades[0]?.closedAt === null, '持久化候选必须先清空平仓日')
      assert(candidate.trades[0]?.closedTradingDayKey === undefined, '持久化候选必须同步清空冻结业务日')
    },
    publish: (trades) => {
      events.push('publish')
      published = trades
    },
  })

  assert(result.kind === 'committed', '有效候选必须完成提交')
  assert(events.join(',') === 'persist,publish', '必须先持久化成功再发布到 Store')
  const committedTrades: Trade[] = published ?? []
  assert(committedTrades[0]?.closedAt === null, '发布后 closedAt 必须为 null')
  assert(committedTrades[0]?.closedTradingDayKey === undefined, '发布后冻结平仓业务日必须移除')
  const cycles = [{ id: 'current', name: '当前', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' }]
  const archiveScope = resolveLiveArchiveScope(cycles, 'all-archives')
  assert(filterLivePerformanceRecords([original], archiveScope, 6).length === 1, '测试前污染记录应被统一绩效选择器纳入')
  assert(
    filterLivePerformanceRecords(committedTrades, archiveScope, 6).length === 0,
    '清理后统一归档选择器必须排除该记录',
  )
  assert(result.before[0]?.closedAt === '2025-11-03', '撤销 patch 必须保留原始 closedAt')
  assert(result.before[0]?.closedTradingDayKey === '2025-11-03', '撤销 patch 必须保留原始冻结业务日')
  const action = buildUndoAction({
    actionId: 'cleanup-action',
    label: '清空污染平仓日',
    createdAt: '2026-08-09T00:00:00.000Z',
    before: result.before,
    after: result.after,
  })
  assert(action, '清理必须生成可撤销字段 patch')
  const undone = applyUndoAction(committedTrades, action, 'undo')
  assert(undone.ok, '清理 patch 必须可以无冲突撤销')
  assert(undoValuesEqual(undone.trades[0], original), '撤销必须逐字段、逐字节恢复原记录值')
}

export async function testPersistenceFailureKeepsOriginalTradeAndDoesNotPublish(): Promise<void> {
  const original = trade('failure', { tags: ['notion-import'] })
  let published = false
  let rejected = false
  try {
    await commitCopiedCloseDateCleanup({
      tradeIds: ['failure'],
      tradingDayStartHour: 6,
      captureLatest: () => ({ trades: [original], snapshot: snapshot([original]) }),
      persistSnapshot: async () => { throw new Error('disk full') },
      publish: () => { published = true },
    })
  } catch (error) {
    rejected = error instanceof Error && error.message === 'disk full'
  }

  assert(rejected, '持久化错误必须透传给调用方')
  assert(!published, '持久化失败不得发布任何内存修改')
  assert(original.closedAt === '2025-11-03' && original.closedTradingDayKey === '2025-11-03', '失败后原记录必须逐字段保持')
}

export async function testStaleSelectionIsRejectedBeforePersistence(): Promise<void> {
  const changed = trade('stale', { closedAt: '2025-11-04', closedTradingDayKey: '2025-11-04', tags: ['notion-import'] })
  let persisted = false
  const result = await commitCopiedCloseDateCleanup({
    tradeIds: ['stale'],
    tradingDayStartHour: 6,
    captureLatest: () => ({ trades: [changed], snapshot: snapshot([changed]) }),
    persistSnapshot: async () => { persisted = true },
    publish: () => { throw new Error('不得发布') },
  })

  assert(result.kind === 'stale-selection', '确认后事实已变化时必须要求重新核对')
  assert(!persisted, '失效选择不得进入持久化边界')
}

export async function testBoundaryDiscardsOldAutosaveIfPublishFailsAfterDurableCommit(): Promise<void> {
  const original = trade('publish-failure', { tags: ['notion-import'] })
  const events: string[] = []
  let rejected = false
  try {
    await commitCopiedCloseDateCleanupThroughBoundary({
      cleanup: {
        tradeIds: ['publish-failure'],
        tradingDayStartHour: 6,
        captureLatest: () => ({ trades: [original], snapshot: snapshot([original]) }),
        persistSnapshot: async () => { events.push('persist') },
        publish: () => { events.push('publish'); throw new Error('publish failed') },
      },
      boundary: {
        lockInteraction: () => { events.push('lock'); return () => { events.push('unlock') } },
        flushBeforeCommit: async () => { events.push('flush') },
        suspendPersist: () => { events.push('suspend') },
        resumePersist: () => { events.push('resume') },
        discardPendingAndResumePersist: () => { events.push('discard-resume') },
      },
    })
  } catch (error) {
    rejected = error instanceof Error && error.message === 'publish failed'
  }

  assert(rejected, '发布异常必须透传并交由上层要求重载')
  assert(
    events.join(',') === 'lock,flush,suspend,persist,publish,discard-resume,unlock',
    '一旦持久化成功，即使发布失败也必须丢弃旧 autosave，绝不能恢复并覆盖新快照',
  )
}

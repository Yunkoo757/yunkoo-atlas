import type { Trade } from '@/data/trades'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { migrateLegacyStageSnapshot } from '@/lib/stageMigration'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function v11Snapshot(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const fixture = createFullPersistedSnapshotFixture() as unknown as Record<string, unknown>
  delete fixture.liveStages
  delete fixture.currentLiveStageId
  delete fixture.scheduledStageRollover
  return { ...fixture, trades: [], weeklyReviews: [], ...patch }
}

const deterministicOptions = {
  now: '2026-08-22T00:00:00.000Z',
  currentTradingDayKey: '2026-08-22',
  idFactory: (sequence: number) => `stage-${sequence}`,
}

function liveTradeWithoutUsableDates(): Trade {
  const trade = createFullPersistedSnapshotFixture().trades[0]!
  return {
    ...trade,
    id: 'unresolved-live',
    status: 'missed',
    openedAt: 'not-a-date',
    closedAt: null,
    closedTradingDayKey: undefined,
  }
}

export function testV11CyclesBecomeStableV12Stages(): void {
  const migrated = migrateLegacyStageSnapshot(v11Snapshot({
    livePerformanceCycles: [
      { id: 'old', name: '旧周期', startTradingDayKey: '2026-08-03', createdAt: '2026-08-03T00:00:00.000Z' },
      { id: 'current', name: '当前', startTradingDayKey: '2026-08-10', createdAt: '2026-08-10T00:00:00.000Z' },
    ],
  }), deterministicOptions)

  assert(migrated.liveStages.length === 2, 'each legacy cycle must become a stage')
  assert(migrated.liveStages[0]?.id === 'stage-1', '阶段 ID 必须由确定性工厂生成')
  assert(migrated.liveStages[0]?.endsOn === '2026-08-09', '归档阶段必须结束于下一阶段前一日')
  assert(migrated.currentLiveStageId === 'stage-2', 'latest cycle must become current')
  assert(migrated.scheduledStageRollover === null, '旧快照不得猜测未来轮换')
  assert(
    migrated.trades.every((trade) => trade.tradeKind === 'paper' || trade.liveStageId !== undefined),
    'all live/case records must be resolved or explicitly pending',
  )
}

export function testUnreliableLegacyMembershipBecomesPending(): void {
  const migrated = migrateLegacyStageSnapshot(
    v11Snapshot({ trades: [liveTradeWithoutUsableDates()] }),
    deterministicOptions,
  )
  assert(migrated.trades[0]?.tradeKind === 'live', '测试前提必须为实盘交易')
  assert(migrated.trades[0].liveStageId === null, 'unreliable ownership must not be guessed')
}

export function testLegacyMembershipUsesLifecycleSpecificDatesAndCaseSource(): void {
  const base = createFullPersistedSnapshotFixture().trades[0]!
  const migrated = migrateLegacyStageSnapshot(v11Snapshot({
    display: { ...createFullPersistedSnapshotFixture().display, tradingDayStartHour: 6 },
    livePerformanceCycles: [
      { id: 'old', name: '旧周期', startTradingDayKey: '2026-08-03', createdAt: '2026-08-03T00:00:00.000Z' },
      { id: 'current', name: '当前', startTradingDayKey: '2026-08-10', createdAt: '2026-08-10T00:00:00.000Z' },
    ],
    trades: [
      { ...base, id: 'closed-old', openedAt: '2026-08-12', closedAt: '2026-08-05', closedTradingDayKey: '2026-08-05' },
      { ...base, id: 'open-current', status: 'open', openedAt: '2026-08-12', closedAt: null, closedTradingDayKey: undefined },
      { ...base, id: 'paper', tradeKind: 'paper', status: 'open', openedAt: '2026-08-12', closedAt: null, closedTradingDayKey: undefined },
      { ...base, id: 'case-source', tradeKind: 'case', sourceTradeId: 'closed-old', recordedAt: '2026-08-20', openedAt: '2026-08-20' },
      { ...base, id: 'case-fallback', tradeKind: 'case', sourceTradeId: 'missing', recordedAt: '2026-08-12', openedAt: 'bad-date' },
    ],
  }), deterministicOptions)

  const byId = new Map(migrated.trades.map((trade) => [trade.id, trade]))
  const closedOld = byId.get('closed-old')
  const openCurrent = byId.get('open-current')
  const caseSource = byId.get('case-source')
  const caseFallback = byId.get('case-fallback')
  assert(closedOld?.tradeKind === 'live' && closedOld.liveStageId === 'stage-1', '终态实盘必须按可靠平仓日归属')
  assert(openCurrent?.tradeKind === 'live' && openCurrent.liveStageId === 'stage-2', '计划/持仓实盘必须按开仓日归属')
  assert(!Object.prototype.hasOwnProperty.call(byId.get('paper')!, 'liveStageId'), '纸面交易不得持久化阶段字段')
  assert(caseSource?.tradeKind === 'case' && caseSource.liveStageId === 'stage-1', '案例必须优先继承有效来源阶段')
  assert(caseFallback?.tradeKind === 'case' && caseFallback.liveStageId === 'stage-2', '来源无效的案例必须按可靠 recordedAt 归属')
}

export function testPreCycleArchiveWeeklyReviewsAndRiskOwnershipAreMigrated(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const preCycleTrade = {
    ...fixture.trades[0]!,
    id: 'pre-cycle-live',
    closedAt: '2026-07-25',
    closedTradingDayKey: '2026-07-25',
  }
  const migrated = migrateLegacyStageSnapshot(v11Snapshot({
    trades: [preCycleTrade],
    livePerformanceCycles: [
      { id: 'current', name: '当前', startTradingDayKey: '2026-08-03', createdAt: '2026-08-03T00:00:00.000Z' },
    ],
    weeklyReviews: [{ ...fixture.weeklyReviews![0]!, weekStart: '2026-07-20', weekEnd: '2026-07-26' }],
  }), deterministicOptions)

  assert(migrated.liveStages.length === 2, '存在周期前记录时必须创建额外归档')
  assert(migrated.liveStages[0]?.name === '更早记录', '周期前归档必须使用规定名称')
  assert(migrated.trades[0]?.tradeKind === 'live' && migrated.trades[0].liveStageId === 'stage-1', '周期前交易必须归入更早记录')
  assert(migrated.weeklyReviews?.[0]?.liveStageId === 'stage-1', '周复盘必须按 weekStart 归属')
  assert(migrated.weeklyRiskPreparations.every((item) => item.liveStageId === migrated.currentLiveStageId), '风险实体必须归入当前阶段')
  assert(migrated.riskPolicyVersions.every((item) => item.liveStageId === migrated.currentLiveStageId), '风险政策必须归入当前阶段')
  assert(migrated.monthlyRiskLimits.every((item) => item.liveStageId === migrated.currentLiveStageId), '月度限额必须归入当前阶段')
  assert(migrated.riskOverrideEvents.every((item) => item.liveStageId === migrated.currentLiveStageId), '风险覆盖事件必须归入当前阶段')
}

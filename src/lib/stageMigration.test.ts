import type { Trade } from '@/data/trades'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import {
  createLegacyStageMigrationOptions,
  migrateLegacyStageSnapshot,
} from '@/lib/stageMigration'

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

export function testLegacyStageMigrationOptionsUseTradingDayStartHour(): void {
  const options = createLegacyStageMigrationOptions(
    v11Snapshot({ display: { tradingDayStartHour: 6 } }),
    new Date(2026, 7, 22, 5, 30, 0),
  )
  assert(options.currentTradingDayKey === '2026-08-21', '凌晨六点前必须仍属于前一交易日')
  assert(options.now === new Date(2026, 7, 22, 5, 30, 0).toISOString(), '迁移时间必须固定为调用方传入时刻')
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

export function testV11StageMigrationDeterministicallyDisambiguatesNormalizedNames(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const migrated = migrateLegacyStageSnapshot(v11Snapshot({
    trades: [{
      ...fixture.trades[0]!,
      id: 'pre-cycle-live',
      closedAt: '2026-06-20',
      closedTradingDayKey: '2026-06-20',
    }],
    livePerformanceCycles: [
      { id: 'older-suffix', name: '更早记录 (2)', startTradingDayKey: '2026-07-01', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'older-collision', name: '  更早记录  ', startTradingDayKey: '2026-07-08', createdAt: '2026-07-08T00:00:00.000Z' },
      { id: 'nfkc-first', name: 'Ａｌｐｈａ', startTradingDayKey: '2026-07-15', createdAt: '2026-07-15T00:00:00.000Z' },
      { id: 'trim-collision', name: '  alpha  ', startTradingDayKey: '2026-07-22', createdAt: '2026-07-22T00:00:00.000Z' },
      { id: 'alpha-suffix', name: 'alpha (2)', startTradingDayKey: '2026-07-29', createdAt: '2026-07-29T00:00:00.000Z' },
      { id: 'case-collision', name: 'Alpha', startTradingDayKey: '2026-08-05', createdAt: '2026-08-05T00:00:00.000Z' },
    ],
  }), deterministicOptions)

  assert(
    migrated.liveStages.map((stage) => stage.name).join('|') ===
      '更早记录|更早记录 (2)|更早记录 (3)|Ａｌｐｈａ|alpha (3)|alpha (2)|Alpha (4)',
    'v11→v12 必须保留首个显示名，并为后续 NFKC/trim/case 碰撞预留全部 legacy 原名后稳定编号',
  )
  assert(
    migrated.liveStages.map((stage) => stage.id).join(',') ===
      'stage-1,stage-2,stage-3,stage-4,stage-5,stage-6,stage-7',
    '名称消歧不得改变确定性阶段 ID 或顺序',
  )
  assert(
    migrated.liveStages.map((stage) => stage.sequence).join(',') === '1,2,3,4,5,6,7' &&
      migrated.currentLiveStageId === 'stage-7',
    '名称消歧不得改变序号或当前阶段指针',
  )
  assert(
    migrated.liveStages[0]?.startsOn === '2026-06-20' &&
      migrated.liveStages[0]?.endsOn === '2026-06-30' &&
      migrated.liveStages[0]?.status === 'archived' &&
      migrated.liveStages[0]?.archivedAt === '2026-07-01T00:00:00.000Z' &&
      migrated.liveStages.at(-1)?.startsOn === '2026-08-05' &&
      migrated.liveStages.at(-1)?.status === 'current' &&
      migrated.liveStages.at(-1)?.endsOn === null,
    '名称消歧不得改变迁移得到的日期、归档时间或阶段状态',
  )
  assert(
    migrated.trades[0]?.tradeKind === 'live' && migrated.trades[0].liveStageId === 'stage-1',
    '名称消歧不得改变实体阶段归属',
  )
  assert(
    migrated.weeklyRiskPreparations.every((item) => item.liveStageId === null) &&
      migrated.riskPolicyVersions.every((item) => item.liveStageId === null) &&
      migrated.monthlyRiskLimits.every((item) => item.liveStageId === null) &&
      migrated.riskOverrideEvents.every((item) => item.liveStageId === null),
    '风险图引用缺失交易时必须整体进入待修复，名称消歧不得猜测当前阶段',
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
  const riskEvent = fixture.riskOverrideEvents[0]!
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
    weeklyReviews: [{
      ...fixture.weeklyReviews![0]!,
      highlightTradeIds: [preCycleTrade.id],
      weekStart: '2026-07-20',
      weekEnd: '2026-07-26',
      riskSnapshot: {
        policyVersions: fixture.riskPolicyVersions,
        dailyOutcomes: [{ ...riskEvent.outcomesAtDecision.day, date: '2026-07-20' }],
        weeklyOutcome: riskEvent.outcomesAtDecision.week,
        monthlyOutcomeAtCompletion: riskEvent.outcomesAtDecision.month,
        overrideEvents: fixture.riskOverrideEvents.map((event) => ({
          ...event,
          tradeId: preCycleTrade.id,
        })),
        frozenAt: fixture.weeklyReviews![0]!.completedAt!,
      },
    }],
  }), deterministicOptions)

  assert(migrated.liveStages.length === 2, '存在周期前记录时必须创建额外归档')
  assert(migrated.liveStages[0]?.name === '更早记录', '周期前归档必须使用规定名称')
  assert(migrated.trades[0]?.tradeKind === 'live' && migrated.trades[0].liveStageId === 'stage-1', '周期前交易必须归入更早记录')
  assert(migrated.weeklyReviews?.[0]?.liveStageId === 'stage-1', '周复盘必须按 weekStart 归属')
  assert(
    migrated.weeklyReviews?.[0]?.riskSnapshot?.policyVersions.every((item) => item.liveStageId === 'stage-1'),
    '历史周复盘的冻结风险策略必须与外层复盘归属一致',
  )
  assert(
    migrated.weeklyReviews?.[0]?.riskSnapshot?.overrideEvents.every((item) => item.liveStageId === 'stage-1'),
    '历史周复盘的冻结风险事件必须与外层复盘归属一致',
  )
  assert(migrated.weeklyRiskPreparations.every((item) => item.liveStageId === null), '缺少被引用交易时风险实体必须待修复')
  assert(migrated.riskPolicyVersions.every((item) => item.liveStageId === null), '缺少被引用交易时风险政策必须待修复')
  assert(migrated.monthlyRiskLimits.every((item) => item.liveStageId === null), '缺少被引用交易时月度限额必须待修复')
  assert(migrated.riskOverrideEvents.every((item) => item.liveStageId === null), '缺少被引用交易时风险覆盖事件必须待修复')
}

export function testLegacyTradeWithoutKindRemainsPaperAndHasNoStageOwnership(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const { tradeKind: _tradeKind, liveStageId: _liveStageId, ...legacyTrade } = fixture.trades[0]! as Trade & { liveStageId?: unknown }
  const migrated = migrateLegacyStageSnapshot(v11Snapshot({
    trades: [legacyTrade],
  }), deterministicOptions)
  const trade = migrated.trades[0] as Trade & { tradeKind?: string; liveStageId?: unknown }

  assert(trade.tradeKind === undefined, '阶段迁移不得把缺失种类的旧交易提前解释为实盘')
  assert(!Object.prototype.hasOwnProperty.call(trade, 'liveStageId'), '缺失种类的旧交易不得携带阶段归属')
}

export function testInvalidOrUnmatchableLegacyWeeklyPeriodsRemainRawAndPending(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const reviews = [
    ['invalid-day', '2026-02-30', '2026-03-08'],
    ['not-monday', '2026-08-04', '2026-08-10'],
    ['bad-end', '2026-08-03', '2026-08-08'],
    ['cross-stage', '2026-08-03', '2026-08-09'],
  ].map(([id, weekStart, weekEnd]) => ({
    ...fixture.weeklyReviews![0]!, id, weekStart, weekEnd,
  }))
  const migrated = migrateLegacyStageSnapshot(v11Snapshot({
    livePerformanceCycles: [
      { id: 'old', name: '旧阶段', startTradingDayKey: '2026-07-01', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'current', name: '当前阶段', startTradingDayKey: '2026-08-06', createdAt: '2026-08-06T00:00:00.000Z' },
    ],
    weeklyReviews: reviews,
  }), deterministicOptions)

  for (const [index, original] of reviews.entries()) {
    const review = migrated.weeklyReviews?.[index]
    assert(review?.liveStageId === null, `${original.id} 不得回退归入 current`)
    assert(review.weekStart === original.weekStart && review.weekEnd === original.weekEnd, '迁移必须保留原始日期')
    assert(review.legacyPeriodQuarantine === true, '不可证明的旧周边界必须显式进入 quarantine')
  }
  assert(!migrated.liveStages.some((stage) => stage.name === '更早记录'), '非法周日期不得创建推测的更早阶段')
}

// Quality-Scenario: LS-V11-MIGRATION

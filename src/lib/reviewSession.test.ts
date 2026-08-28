import type { Trade } from '@/data/trades'
import { resolveTradeDetailReturn } from '@/lib/tradeRoute'
import {
  DEFAULT_REVIEW_SESSION_FILTERS,
  REVIEW_SESSION_PRESETS,
  applyReviewSessionPreset,
  matchReviewSessionPreset,
  buildReviewAssessmentPatch,
  buildReviewSessionPool,
  clearReviewSessionFilters,
  clearReviewSessionStorage,
  loadReviewSession,
  loadReviewSessionFilters,
  reconcileReviewSession,
  reviewFiltersForNextRound,
  reviewSessionFiltersStorageKey,
  reviewSessionStorageKey,
  saveReviewSession,
  saveReviewSessionFilters,
  shuffleReviewSessionIds,
  getReviewSessionContent,
  type ReviewSessionSnapshot,
} from '@/lib/reviewSession'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const baseTrade: Extract<Trade, { tradeKind: 'live' }> = {
  id: 'live-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 100,
  rMultiple: 2,
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '<p>等待确认后入场</p>',
  liveStageId: 'stage-current',
}

const FIXED_TRADING_DAY_KEY = '2026-08-11'
const FIXED_TRADING_DAY_START_HOUR = 6
const REVIEW_STAGE_CONTEXT = {
  liveStages: [
    {
      id: 'stage-oldest',
      sequence: 1,
      name: '早期实盘',
      status: 'archived' as const,
      startsOn: '2026-01-01',
      endsOn: '2026-03-31',
      createdAt: '2026-01-01T00:00:00.000Z',
      archivedAt: '2026-04-01T00:00:00.000Z',
    },
    {
      id: 'stage-previous',
      sequence: 2,
      name: '突破训练',
      status: 'archived' as const,
      startsOn: '2026-04-01',
      endsOn: '2026-07-31',
      createdAt: '2026-04-01T00:00:00.000Z',
      archivedAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'stage-current',
      sequence: 3,
      name: '当前执行',
      status: 'current' as const,
      startsOn: '2026-08-01',
      endsOn: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      archivedAt: null,
    },
  ],
  currentLiveStageId: 'stage-current',
}

function buildPool(
  trades: readonly Trade[],
  filterPatch: Record<string, unknown> = {},
): Trade[] {
  return buildReviewSessionPool(
    trades,
    { ...DEFAULT_REVIEW_SESSION_FILTERS, ...filterPatch },
    new Set(),
    FIXED_TRADING_DAY_KEY,
    FIXED_TRADING_DAY_START_HOUR,
    REVIEW_STAGE_CONTEXT,
  )
}

function paperTrade(id: string): Trade {
  const { liveStageId: _liveStageId, ...withoutStage } = baseTrade
  return { ...withoutStage, id, ref: `PAPER-${id}`, tradeKind: 'paper' }
}

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

export function testDefaultReviewPoolIncludesCurrentAndEveryHistoricalStageByOwnership(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'oldest', ref: 'LIVE-OLDEST', liveStageId: 'stage-oldest', openedAt: '2099-01-01' },
    { ...baseTrade, id: 'previous', ref: 'LIVE-PREVIOUS', liveStageId: 'stage-previous', openedAt: '1999-01-01' },
    { ...baseTrade, id: 'current', ref: 'LIVE-CURRENT', liveStageId: 'stage-current', openedAt: '2001-01-01' },
    { ...baseTrade, id: 'pending-null', ref: 'LIVE-NULL', liveStageId: null },
    { ...baseTrade, id: 'pending-undefined', ref: 'LIVE-UNDEFINED', liveStageId: undefined },
    { ...baseTrade, id: 'unknown-stage', ref: 'LIVE-UNKNOWN', liveStageId: 'stage-missing' },
  ]

  const pool = buildPool(trades, { includeCases: false, includeLiveTrades: true })

  assert(
    pool.map((trade) => trade.id).join(',') === 'oldest,previous,current',
    '默认阶段来源必须按实体归属覆盖当前及全部历史，并排除待整理或未知阶段；编辑日期不得改变成员关系',
  )
}

export function testReviewStageSourcesSelectExactStageOwnedMembership(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'oldest', ref: 'LIVE-OLDEST', liveStageId: 'stage-oldest' },
    { ...baseTrade, id: 'previous', ref: 'LIVE-PREVIOUS', liveStageId: 'stage-previous' },
    { ...baseTrade, id: 'current', ref: 'LIVE-CURRENT', liveStageId: 'stage-current' },
  ]

  assert(
    buildPool(trades, { includeCases: false, includeLiveTrades: true, stageSource: 'current' })
      .map((trade) => trade.id).join(',') === 'current',
    '仅当前阶段必须只保留 currentLiveStageId 的实盘',
  )
  assert(
    buildPool(trades, { includeCases: false, includeLiveTrades: true, stageSource: 'all-history' })
      .map((trade) => trade.id).join(',') === 'oldest,previous',
    '全部历史阶段必须排除当前阶段实盘',
  )
  assert(
    buildPool(trades, {
      includeCases: false,
      includeLiveTrades: true,
      stageSource: { stageIds: ['stage-current', 'stage-previous', 'stage-previous', 'missing'] },
    }).map((trade) => trade.id).join(',') === 'previous,current',
    '自选阶段必须去重、剔除缺失 ID，并按稳定阶段顺序选择精确成员',
  )
  assert(
    buildPool(trades, { includeCases: false, includeLiveTrades: true, stageSource: { stageIds: [] } }).length === 0,
    '空的自选阶段不得静默扩大到默认范围',
  )
}

export function testReviewSessionCasesIgnoreLiveStageSource(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'oldest', ref: 'CAS-OLDEST', tradeKind: 'case', liveStageId: 'stage-oldest' },
    { ...baseTrade, id: 'previous', ref: 'CAS-PREVIOUS', tradeKind: 'case', liveStageId: 'stage-previous' },
    { ...baseTrade, id: 'current', ref: 'CAS-CURRENT', tradeKind: 'case', liveStageId: 'stage-current' },
    { ...baseTrade, id: 'pending-null', ref: 'CAS-NULL', tradeKind: 'case', liveStageId: null },
    { ...baseTrade, id: 'unknown-stage', ref: 'CAS-UNKNOWN', tradeKind: 'case', liveStageId: 'stage-missing' },
    { ...baseTrade, id: 'current-live', ref: 'LIVE-CURRENT', liveStageId: 'stage-current' },
    { ...baseTrade, id: 'old-live', ref: 'LIVE-OLD', liveStageId: 'stage-oldest' },
  ]

  assert(
    buildPool(trades, { includeLiveTrades: false, stageSource: 'current' })
      .map((trade) => trade.id).join(',') === 'oldest,previous,current,pending-null,unknown-stage',
    '阶段来源不得切割案例；未知或待整理阶段的案例仍可进入候选池',
  )
  assert(
    buildPool(trades, { includeLiveTrades: true, includeCases: true, stageSource: 'current' })
      .map((trade) => trade.id).join(',') === 'oldest,previous,current,pending-null,unknown-stage,current-live',
    '仅当前阶段只约束实盘，案例仍含全部历史',
  )
}

export function testStageSourceLeavesPaperChoiceIndependentAndPreservesEligibility(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'eligible-history', ref: 'CAS-ELIGIBLE', tradeKind: 'case', liveStageId: 'stage-previous' },
    { ...baseTrade, id: 'eligible-current', ref: 'CAS-CURRENT', tradeKind: 'case', liveStageId: 'stage-current' },
    { ...baseTrade, id: 'deleted-history', ref: 'CAS-DELETED', tradeKind: 'case', liveStageId: 'stage-previous', deletedAt: '2026-08-10T00:00:00.000Z' },
    { ...baseTrade, id: 'mastered-history', ref: 'CAS-MASTERED', tradeKind: 'case', liveStageId: 'stage-previous', masteryState: 'mastered' },
    { ...baseTrade, id: 'future-history', ref: 'CAS-FUTURE', tradeKind: 'case', liveStageId: 'stage-previous', nextReviewAt: '2099-01-01' },
    { ...baseTrade, id: 'empty-live-history', ref: 'LIVE-EMPTY', tradeKind: 'live', liveStageId: 'stage-previous', note: '<p>&nbsp;</p>' },
    paperTrade('paper-independent'),
  ]

  const historyWithAccounts = buildPool(trades, {
    stageSource: 'all-history',
    includeAccountTrades: true,
  })
  assert(
    historyWithAccounts.map((trade) => trade.id).join(',') === 'eligible-history,eligible-current,empty-live-history,paper-independent',
    '阶段来源只过滤实盘；案例保留全部历史，删除、掌握、到期继续生效，模拟盘仍由账户交易选项独立纳入',
  )
  assert(
    buildPool(trades, { stageSource: 'all-history', includeAccountTrades: false })
      .map((trade) => trade.id).join(',') === 'eligible-history,eligible-current,empty-live-history',
    '关闭账户交易选项必须独立排除模拟盘',
  )
}

export function testReviewSessionTimingFiltersDueCasesDeterministically(): void {
  const reviewCase = {
    ...baseTrade,
    tradeKind: 'case',
    masteryState: 'new',
  } as Trade
  const trades: Trade[] = [
    { ...reviewCase, id: 'today', nextReviewAt: '2026-08-11' },
    { ...reviewCase, id: 'overdue', nextReviewAt: '2026-08-10' },
    { ...reviewCase, id: 'future', nextReviewAt: '2026-08-12' },
    { ...reviewCase, id: 'mastered', masteryState: 'mastered', nextReviewAt: '2026-08-10' },
    { ...reviewCase, id: 'missing', nextReviewAt: null },
    { ...reviewCase, id: 'invalid', nextReviewAt: 'not-a-date' },
    { ...reviewCase, id: 'invalid-ymd', nextReviewAt: '2099-02-30' },
    { ...reviewCase, id: 'legacy-due', nextReviewAt: '2026-08-11T05:59:00' },
    { ...reviewCase, id: 'legacy-future', nextReviewAt: '2026-08-12T06:00:00' },
    { ...reviewCase, id: 'deleted', deletedAt: '2026-08-11T10:00:00.000Z' },
    { ...baseTrade, id: 'account' },
  ]
  const filters = {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includeAccountTrades: true,
  }

  const duePool = buildReviewSessionPool(
    trades,
    filters,
    new Set(),
    FIXED_TRADING_DAY_KEY,
    FIXED_TRADING_DAY_START_HOUR,
    REVIEW_STAGE_CONTEXT,
  )
  assert(
    duePool.map((trade) => trade.id).join(',') === 'today,overdue,missing,invalid,invalid-ymd,legacy-due,account',
    '到期范围必须精确包含今天、逾期、缺失/无效日期、按业务日到期的旧 ISO 案例与合格账户交易',
  )

  const allPool = buildReviewSessionPool(
    trades,
    { ...filters, reviewTiming: 'all' },
    new Set(),
    FIXED_TRADING_DAY_KEY,
    FIXED_TRADING_DAY_START_HOUR,
    REVIEW_STAGE_CONTEXT,
  )
  assert(
    allPool.map((trade) => trade.id).join(',') === 'today,overdue,future,mastered,missing,invalid,invalid-ymd,legacy-due,legacy-future,account',
    '全部范围必须包含未来与已掌握案例，同时继续排除已删除记录',
  )
}

export function testReviewSessionRejectsLooseLegacyDateStringsAsDue(): void {
  const reviewCase = {
    ...baseTrade,
    tradeKind: 'case',
    masteryState: 'new',
  } as Trade
  const trades: Trade[] = [
    { ...reviewCase, id: 'loose-month', nextReviewAt: '2099-1-1' },
    { ...reviewCase, id: 'slash-date', nextReviewAt: '2099/01/01' },
    { ...reviewCase, id: 'natural-language', nextReviewAt: 'August 1, 2099' },
    { ...reviewCase, id: 'overflowing-iso', nextReviewAt: '2099-02-30T06:00:00' },
    { ...reviewCase, id: 'zoned-legacy-future', nextReviewAt: '2099-01-01T12:00:00+08:00' },
  ]

  const pool = buildReviewSessionPool(
    trades,
    DEFAULT_REVIEW_SESSION_FILTERS,
    new Set(),
    FIXED_TRADING_DAY_KEY,
    FIXED_TRADING_DAY_START_HOUR,
    REVIEW_STAGE_CONTEXT,
  )

  assert(
    pool.map((trade) => trade.id).join(',') === 'loose-month,slash-date,natural-language,overflowing-iso',
    '严格且日历有效的远期 legacy ISO datetime 必须被解析并排除，其他宽松或溢出日期必须视为到期',
  )
}

export function testReviewSessionDefaultPoolIncludesCasesAndLiveButNotPaper(): void {
  const trades: Trade[] = [
    baseTrade,
    { ...baseTrade, id: 'paper-1', ref: 'TRD-2', tradeKind: 'paper' },
    { ...baseTrade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' },
    {
      ...baseTrade,
      id: 'deleted-1',
      ref: 'TRD-3',
      deletedAt: '2026-07-16T00:00:00.000Z',
    },
  ]

  const defaultPool = buildReviewSessionPool(trades, DEFAULT_REVIEW_SESSION_FILTERS, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR, REVIEW_STAGE_CONTEXT)
  assert(defaultPool.map((trade) => trade.id).join(',') === 'live-1,case-1',
    '默认随机复盘池必须包含实盘与案例，但不得自动扩大到模拟盘')

  const expandedPool = buildReviewSessionPool(trades, {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includeAccountTrades: true,
  }, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR, REVIEW_STAGE_CONTEXT)
  assert(expandedPool.map((trade) => trade.id).join(',') === 'live-1,paper-1,case-1',
    '复盘设置仍应允许显式加入账户交易')
}

export function testReviewSessionLiveAndPaperIgnoreReviewStatus(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'reviewed-live' },
    { ...baseTrade, id: 'unreviewed-live', reviewStatus: 'unreviewed' },
    { ...baseTrade, id: 'open-live', status: 'open', closedAt: null },
    { ...baseTrade, id: 'deleted-live', deletedAt: '2026-07-16T00:00:00.000Z' },
    paperTrade('reviewed-paper'),
    { ...paperTrade('unreviewed-paper'), reviewStatus: 'unreviewed' },
    { ...paperTrade('open-paper'), status: 'open', closedAt: null },
  ]

  const pool = buildPool(trades, {
    includeCases: false,
    includeLiveTrades: true,
    includePaperTrades: true,
    requireContent: false,
  })

  assert(
    pool.map((trade) => trade.id).join(',') === 'reviewed-live,unreviewed-live,reviewed-paper,unreviewed-paper',
    '实盘与模拟盘只要已结束或已错过且未删除即可进入候选池，不得要求 reviewStatus',
  )
}

export function testReviewSessionRequireContentIsTheOnlyContentFilter(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'empty-live', note: '<p>&nbsp;</p>' },
    { ...baseTrade, id: 'text-live', note: '<p>假突破后没有追单</p>' },
    { ...paperTrade('empty-paper'), note: '<p></p>' },
    { ...paperTrade('image-paper'), note: '<p></p><img src="journal-asset://chart-1">' },
    { ...baseTrade, id: 'empty-case', tradeKind: 'case', note: '<p> </p>' },
    { ...baseTrade, id: 'text-case', tradeKind: 'case', note: '<p>案例洞见</p>' },
  ]

  const withoutContent = buildPool(trades, {
    includeCases: true,
    includeLiveTrades: true,
    includePaperTrades: true,
    requireContent: false,
    reviewTiming: 'all',
  })
  assert(
    withoutContent.map((trade) => trade.id).join(',') ===
      'empty-live,text-live,empty-paper,image-paper,empty-case,text-case',
    '关闭仅含有效图文时，不得再以正文是否存在过滤三类来源',
  )

  const withContent = buildPool(trades, {
    includeCases: true,
    includeLiveTrades: true,
    includePaperTrades: true,
    requireContent: true,
    reviewTiming: 'all',
  })
  assert(
    withContent.map((trade) => trade.id).join(',') === 'text-live,image-paper,text-case',
    '开启仅含有效图文时，三类来源必须统一要求有效文本或图片',
  )
}

export function testReviewSessionPaperIgnoresLiveStageSource(): void {
  const { liveStageId: _liveStageId, ...paperFields } = baseTrade
  const trades: Trade[] = [
    { ...baseTrade, id: 'current-live', liveStageId: 'stage-current' },
    { ...baseTrade, id: 'old-live', liveStageId: 'stage-oldest' },
    { ...paperFields, id: 'any-paper', ref: 'PAPER-any', tradeKind: 'paper' },
  ]

  const currentOnly = buildPool(trades, {
    includeCases: false,
    includeLiveTrades: true,
    includePaperTrades: true,
    requireContent: false,
    stageSource: 'current',
  })
  assert(
    currentOnly.map((trade) => trade.id).join(',') === 'current-live,any-paper',
    '模拟盘不受实盘阶段来源限制；当前阶段过滤只能约束实盘',
  )

  const emptyLiveSource = buildPool(trades, {
    includeCases: false,
    includeLiveTrades: true,
    includePaperTrades: false,
    requireContent: false,
    stageSource: { stageIds: [] },
  })
  assert(emptyLiveSource.length === 0, '某个来源为空时数量必须是零，不得回退到其他来源')
}

export function testReviewSessionContentFilterKeepsTextAndImageNotes(): void {
  const filters = {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includeAccountTrades: true,
    requireContent: true,
  }
  const trades: Trade[] = [
    { ...baseTrade, id: 'empty', note: '<p> &nbsp; </p>' },
    { ...baseTrade, id: 'text', note: '<p>假突破后没有追单</p>' },
    { ...baseTrade, id: 'image', note: '<p></p><img src="journal-asset://chart-1">' },
  ]

  const pool = buildReviewSessionPool(trades, filters, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR, REVIEW_STAGE_CONTEXT)

  assert(pool.map((trade) => trade.id).join(',') === 'text,image',
    '仅含有效图文应保留正文笔记和纯图片笔记')
}

export function testReviewSessionCaseContentIncludesOwnInsightsAndSourceReview(): void {
  const reviewCase = {
    ...baseTrade,
    id: 'case-with-source',
    tradeKind: 'case',
    note: '<p>案例洞见</p>',
    sourceNoteHtml: '<p>原交易复盘</p>',
  } as Trade

  const content = getReviewSessionContent(reviewCase)

  assert(content.includes('案例洞见'), '随机复盘必须显示案例自身补充的洞见')
  assert(content.includes('原交易复盘'), '随机复盘必须显示案例来源交易的复盘快照')
  assert(getReviewSessionContent(baseTrade) === baseTrade.note, '账户交易应继续读取自身复盘正文')
}

export function testReviewSessionCaseScopeUsesSharedCasePriorityRule(): void {
  const cases: Trade[] = [
    { ...baseTrade, id: 'focused-case', ref: 'CAS-1', tradeKind: 'case', isFocusCase: true },
    {
      ...baseTrade,
      id: 'ordinary-case',
      ref: 'CAS-2',
      tradeKind: 'case',
      reviewCategory: 'normal',
    },
  ]
  const pool = buildReviewSessionPool(cases, {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includeAccountTrades: false,
    caseScope: 'focus',
  }, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR, REVIEW_STAGE_CONTEXT)

  assert(pool.map((trade) => trade.id).join(',') === 'focused-case',
    '重点 scope 应与案例库一致地包含重点案例，且不依赖交易星标')
}

export function testReviewSessionPresetsCoverCasesMistakesAndMissed(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'exemplar', ref: 'CAS-EX', tradeKind: 'case', caseType: 'exemplar' },
    { ...baseTrade, id: 'mistake', ref: 'CAS-MIS', tradeKind: 'case', caseType: 'mistake', reviewCategory: 'mistake' },
    { ...baseTrade, id: 'missed', ref: 'CAS-SKIP', tradeKind: 'case', caseType: 'missed', status: 'missed' },
    { ...baseTrade, id: 'mastered-exemplar', ref: 'CAS-OLD', tradeKind: 'case', caseType: 'exemplar', masteryState: 'mastered' },
    { ...baseTrade, id: 'live', ref: 'TRD-1' },
  ]
  const casesOnly = applyReviewSessionPreset(
    DEFAULT_REVIEW_SESSION_FILTERS,
    REVIEW_SESSION_PRESETS.find((preset) => preset.id === 'exemplar')!,
  )
  const mistakes = applyReviewSessionPreset(
    DEFAULT_REVIEW_SESSION_FILTERS,
    REVIEW_SESSION_PRESETS.find((preset) => preset.id === 'mistakes')!,
  )
  const missed = applyReviewSessionPreset(
    DEFAULT_REVIEW_SESSION_FILTERS,
    REVIEW_SESSION_PRESETS.find((preset) => preset.id === 'missed')!,
  )

  assert(matchReviewSessionPreset(DEFAULT_REVIEW_SESSION_FILTERS) === 'due', '默认设置必须对应到期复盘预置')
  assert(matchReviewSessionPreset(casesOnly) === 'exemplar', '交易案例预置必须可识别')
  assert(
    buildPool(trades, casesOnly).map((trade) => trade.id).join(',') === 'exemplar,mistake,missed,mastered-exemplar',
    '交易案例预置必须覆盖全部案例知识库，含已掌握，且不含实盘',
  )
  assert(
    buildPool(trades, mistakes).map((trade) => trade.id).join(',') === 'mistake',
    '错误合集预置只能抽到错题案例',
  )
  assert(
    buildPool(trades, missed).map((trade) => trade.id).join(',') === 'missed',
    '错过的案例预置只能抽到错过机会',
  )
}

export function testReviewSessionMistakesScopeExcludesMissedCases(): void {
  const cases: Trade[] = [
    {
      ...baseTrade,
      id: 'mistake-case',
      ref: 'CAS-1',
      tradeKind: 'case',
      caseType: 'mistake',
      reviewCategory: 'mistake',
      mistakeTags: ['追单'],
    },
    {
      ...baseTrade,
      id: 'missed-with-tags',
      ref: 'CAS-2',
      tradeKind: 'case',
      status: 'missed',
      caseType: 'missed',
      reviewCategory: 'mistake',
      mistakeTags: ['情绪化交易'],
      pnl: null,
      rMultiple: 2,
    },
  ]
  const pool = buildReviewSessionPool(cases, {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includeAccountTrades: false,
    caseScope: 'mistakes',
  }, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR, REVIEW_STAGE_CONTEXT)

  assert(pool.map((trade) => trade.id).join(',') === 'mistake-case',
    '随机复盘错题 scope 不得抽到带错误标签的错过机会')
}

export function testReviewSessionShufflePreservesUniqueMembershipAndInput(): void {
  const input = ['a', 'b', 'c', 'd']
  const shuffled = shuffleReviewSessionIds(input, () => 0)

  assert(input.join(',') === 'a,b,c,d', '洗牌不得修改输入数组')
  assert(shuffled.join(',') === 'b,c,d,a', 'Fisher–Yates 应按注入的随机数移动成员')
  assert(new Set(shuffled).size === input.length, '单轮队列不得出现重复 id')
}

export function testReviewAssessmentBuildsMasteryAndRecheckPlans(): void {
  const now = new Date(2026, 6, 16, 12)
  for (const assessment of ['unfamiliar', 'recheck', 'mastered'] as const) {
    assert(
      Object.keys(buildReviewAssessmentPatch(baseTrade, assessment, now)).length === 0,
      `账户交易的 ${assessment} 评估不得写入案例字段`,
    )
  }

  const reviewCase = { ...baseTrade, id: 'case', tradeKind: 'case' } as Trade
  const caseRecheck = buildReviewAssessmentPatch(reviewCase, 'recheck', now)
  assert(caseRecheck.reviewStatus === 'unreviewed' && caseRecheck.reviewCategory === 'recheck',
    '案例的基本理解仍应进入待复看分类')
  const caseMastered = buildReviewAssessmentPatch(reviewCase, 'mastered', now)
  assert(caseMastered.reviewStatus === 'reviewed' && caseMastered.reviewCategory === 'mastered',
    '案例的已经掌握仍应同步案例完成状态')
}

export function testReviewSessionStorageIsVersionedAndIsolatedByLibrary(): void {
  const storage = new MemoryStorage()
  const snapshot: ReviewSessionSnapshot = {
    ids: ['case-1', 'live-1'],
    cursor: 1,
    filters: { ...DEFAULT_REVIEW_SESSION_FILTERS, includeAccountTrades: true },
    assessments: { 'case-1': 'recheck' },
  }

  const runtimeSnapshot = Object.assign({}, snapshot, { transientTrade: baseTrade })
  assert(saveReviewSession('library-a', runtimeSnapshot, storage), '可用 sessionStorage 应保存成功')
  assert(loadReviewSession('library-a', storage)?.cursor === 1, '同一资料库应恢复当前进度')
  assert(loadReviewSession('library-b', storage) === null, '其他资料库不得读取当前队列')
  assert(reviewSessionStorageKey('library-a').includes(':v3:'), '拆分实盘/模拟盘后的会话存储键必须使用 v3')

  const raw = storage.getItem(reviewSessionStorageKey('library-a')) ?? ''
  assert(Object.keys(JSON.parse(raw)).sort().join(',') === 'assessments,cursor,filters,ids',
    '会话只应保存随机队列、游标、范围与本轮评估')
  assert(JSON.parse(raw).filters.reviewTiming === 'due', '新会话必须明确保存默认的到期范围')

  storage.setItem(reviewSessionStorageKey('legacy-library'), JSON.stringify({
    ids: ['future-case'],
    cursor: 0,
    filters: {
      includeCases: true,
      includeAccountTrades: false,
      caseScope: 'all',
      requireContent: false,
    },
    assessments: {},
  }))
  const legacy = loadReviewSession('legacy-library', storage)
  if (!legacy) throw new Error('旧会话必须能够加载')
  assert(legacy.filters.reviewTiming === 'all', '旧会话缺少时间范围时必须规范为全部案例')
  assert(legacy.restoredLegacyReviewTiming, '旧会话必须保留仅限当前恢复轮次的 timing 兼容标记')
  assert(saveReviewSession('legacy-library', legacy, storage), '恢复中的旧轮必须可以继续保存进度')
  const resavedLegacy = JSON.parse(storage.getItem(reviewSessionStorageKey('legacy-library')) ?? '{}')
  assert(resavedLegacy.filters?.reviewTiming === undefined, '恢复中的旧轮不得因自动保存而丢失 legacy all 语义')
  const reconciledLegacy = reconcileReviewSession(
    legacy,
    [{ ...baseTrade, id: 'future-case', tradeKind: 'case', masteryState: 'mastered', nextReviewAt: '2099-01-01' }],
    new Set(),
    FIXED_TRADING_DAY_KEY,
    FIXED_TRADING_DAY_START_HOUR,
    REVIEW_STAGE_CONTEXT,
  )
  assert(reconciledLegacy?.ids.join(',') === 'future-case', '旧会话的未来或已掌握成员不得在恢复时被静默删减')

  const nextFilters = reviewFiltersForNextRound({
    ...legacy,
    filters: {
      ...legacy.filters,
      includeAccountTrades: true,
      caseScope: 'mistakes',
      requireContent: true,
    },
  })
  assert(nextFilters.reviewTiming === 'due', '旧轮完成后的新轮必须恢复默认 due')
  assert(
    nextFilters.includeAccountTrades && nextFilters.caseScope === 'mistakes' && nextFilters.requireContent,
    '新轮只重置 timing，必须保留其他合法筛选',
  )
  const nextRoundPool = buildReviewSessionPool([
    { ...baseTrade, id: 'today-case', tradeKind: 'case', caseType: 'mistake', masteryState: 'new', nextReviewAt: FIXED_TRADING_DAY_KEY },
    { ...baseTrade, id: 'future-case', tradeKind: 'case', caseType: 'mistake', masteryState: 'new', nextReviewAt: '2099-01-01' },
    { ...baseTrade, id: 'mastered-case', tradeKind: 'case', caseType: 'mistake', masteryState: 'mastered', nextReviewAt: FIXED_TRADING_DAY_KEY },
  ], nextFilters, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR, REVIEW_STAGE_CONTEXT)
  assert(nextRoundPool.map((trade) => trade.id).join() === 'today-case', '旧轮后的新轮必须排除未来与已掌握案例')
  assert(
    reviewFiltersForNextRound({ ...legacy, restoredLegacyReviewTiming: undefined }).reviewTiming === 'all',
    '显式选择 all 的现代轮次结束后必须保留用户筛选，不能被 legacy 兼容逻辑重置',
  )
}

export function testReviewSessionSystemPoolOriginRoundTripsInTemporaryStorage(): void {
  const storage = new MemoryStorage()
  const snapshot: ReviewSessionSnapshot = {
    ids: ['case-1'],
    cursor: 0,
    filters: {
      ...DEFAULT_REVIEW_SESSION_FILTERS,
      includePaperTrades: true,
      reviewTiming: 'all',
    },
    systemPoolId: 'boosted',
    assessments: {},
  }

  assert(saveReviewSession('system-pool-library', snapshot, storage), '系统池轮次必须可保存')
  const restored = loadReviewSession('system-pool-library', storage)
  assert(restored?.systemPoolId === 'boosted', '系统池来源必须完成临时存储往返')
  assert(restored?.ids.join(',') === 'case-1', '系统池轮次必须继续使用冻结 ID 快照')
}

export function testReviewSessionV1V2AccountFilterMigratesWithoutBroadeningPaper(): void {
  for (const version of [1, 2]) {
    for (const includeAccountTrades of [false, true]) {
      const storage = new MemoryStorage()
      const libraryId = `legacy-v${version}-${String(includeAccountTrades)}`
      const legacyKey = `yunkoo-atlas:review-session:v${version}:${encodeURIComponent(libraryId)}`
      storage.setItem(legacyKey, JSON.stringify({
        ids: ['preserved-current', 'preserved-next'],
        cursor: 1,
        filters: {
          includeCases: true,
          includeAccountTrades,
          caseScope: 'all',
          requireContent: false,
          reviewTiming: 'due',
          stageSource: 'current-and-history',
        },
        assessments: { 'preserved-current': 'recheck' },
      }))

      const restored = loadReviewSession(libraryId, storage)
      if (!restored) throw new Error('旧会话必须成功迁移')
      assert(restored.ids.join(',') === 'preserved-current,preserved-next', '迁移不得重建活动轮次 ID')
      assert(restored.cursor === 1 && restored.assessments['preserved-current'] === 'recheck', '迁移必须保留 cursor 与 assessments')
      assert(
        restored.filters.includeLiveTrades === includeAccountTrades &&
          restored.filters.includePaperTrades === includeAccountTrades,
        '旧账户交易开关必须按原池语义确定性拆为 live/paper，不能静默扩大 paper',
      )
      assert(storage.getItem(reviewSessionStorageKey(libraryId)) !== null, '旧会话必须先耐久升级为 v3')
      assert(storage.getItem(legacyKey) === null, 'v3 写入成功后必须清理旧会话键')
    }
  }
}

export function testReviewSessionLiveAndPaperSourcesAreIndependent(): void {
  const trades = [baseTrade, paperTrade('paper-independent')]
  const onlyLive = buildPool(trades, {
    includeCases: false,
    includeLiveTrades: true,
    includePaperTrades: false,
    includeAccountTrades: false,
  })
  const onlyPaper = buildPool(trades, {
    includeCases: false,
    includeLiveTrades: false,
    includePaperTrades: true,
    includeAccountTrades: false,
  })
  assert(onlyLive.map((trade) => trade.id).join(',') === 'live-1', '仅实盘开关不得包含模拟盘')
  assert(onlyPaper.map((trade) => trade.id).join(',') === 'paper-independent', '仅模拟盘开关不得包含实盘')
}

export function testReviewSessionStageSourcePersistsAndMissingFieldMigratesToDefault(): void {
  const storage = new MemoryStorage()
  const snapshot: ReviewSessionSnapshot = {
    ids: ['case-1'],
    cursor: 0,
    filters: {
      ...DEFAULT_REVIEW_SESSION_FILTERS,
      stageSource: { stageIds: ['stage-previous', 'stage-current'] },
    },
    assessments: {},
  }

  assert(saveReviewSession('stage-source-library', snapshot, storage), '阶段来源会话必须可保存')
  const raw = JSON.parse(storage.getItem(reviewSessionStorageKey('stage-source-library')) ?? '{}')
  assert(
    raw.filters?.stageSource?.stageIds?.join(',') === 'stage-previous,stage-current',
    '会话存储必须逐轮保存自选阶段来源',
  )
  const restored = loadReviewSession('stage-source-library', storage)
  assert(
    typeof restored?.filters.stageSource === 'object' &&
      restored.filters.stageSource.stageIds.join(',') === 'stage-previous,stage-current',
    '自选阶段来源必须完成 storage round-trip',
  )

  storage.setItem(reviewSessionStorageKey('legacy-stage-source'), JSON.stringify({
    ids: ['case-1'],
    cursor: 0,
    filters: {
      includeCases: true,
      includeAccountTrades: false,
      caseScope: 'all',
      requireContent: false,
      reviewTiming: 'due',
    },
    assessments: {},
  }))
  assert(
    loadReviewSession('legacy-stage-source', storage)?.filters.stageSource === 'current-and-history',
    '旧会话缺少 stageSource 时必须确定性迁移为当前阶段加全部历史',
  )
}

export function testReconcilePrunesMissingStageIdsWithoutCancellingSurvivingRound(): void {
  const snapshot: ReviewSessionSnapshot = {
    ids: ['removed-stage-live', 'surviving-case', 'paper-survivor'],
    cursor: 1,
    filters: {
      ...DEFAULT_REVIEW_SESSION_FILTERS,
      includeAccountTrades: true,
      stageSource: {
        stageIds: ['stage-current', 'stage-removed', 'stage-previous', 'stage-current'],
      },
    },
    assessments: { 'removed-stage-live': 'mastered', 'surviving-case': 'recheck' },
  }
  const trades: Trade[] = [
    { ...baseTrade, id: 'removed-stage-live', ref: 'LIVE-REMOVED', liveStageId: 'stage-removed' },
    { ...baseTrade, id: 'surviving-case', ref: 'CAS-SURVIVING', tradeKind: 'case', liveStageId: 'stage-current' },
    paperTrade('paper-survivor'),
  ]

  const restored = reconcileReviewSession(
    snapshot,
    trades,
    new Set(),
    FIXED_TRADING_DAY_KEY,
    FIXED_TRADING_DAY_START_HOUR,
    REVIEW_STAGE_CONTEXT,
  )

  assert(restored?.ids.join(',') === 'surviving-case,paper-survivor', '缺失阶段只能移除其失效实体，存活实体与模拟盘必须保留')
  assert(restored?.cursor === 0, '移除当前卡之前的失效实体后必须继续停留在同一张存活卡')
  assert(restored?.assessments['surviving-case'] === 'recheck', '存活实体的本轮评估必须保留')
  assert(restored?.assessments['removed-stage-live'] === undefined, '失效阶段实盘的评估必须同步剪枝')
  assert(
    typeof restored?.filters.stageSource === 'object' &&
      restored.filters.stageSource.stageIds.join(',') === 'stage-previous,stage-current',
    '自选阶段必须剔除缺失与重复 ID，并按阶段 sequence 稳定排序',
  )
}

export function testReconcileKeepsExplicitEmptySelectionInsteadOfBroadeningScope(): void {
  const snapshot: ReviewSessionSnapshot = {
    ids: ['removed-stage-live'],
    cursor: 0,
    filters: {
      ...DEFAULT_REVIEW_SESSION_FILTERS,
      includeCases: false,
      includeLiveTrades: true,
      stageSource: { stageIds: ['stage-removed'] },
    },
    assessments: {},
  }

  const restored = reconcileReviewSession(
    snapshot,
    [{ ...baseTrade, id: 'removed-stage-live', liveStageId: 'stage-removed' }],
    new Set(),
    FIXED_TRADING_DAY_KEY,
    FIXED_TRADING_DAY_START_HOUR,
    REVIEW_STAGE_CONTEXT,
  )

  assert(restored !== null, '全部自选阶段消失时必须保留可呈现的显式空范围状态')
  assert(restored?.ids.length === 0 && restored.cursor === 0, '显式空范围必须清空失效队列而不伪造完成进度')
  assert(
    typeof restored?.filters.stageSource === 'object' && restored.filters.stageSource.stageIds.length === 0,
    '显式空范围不得回退到默认阶段来源',
  )
}

export function testReconcilePreservesActiveItemsAcrossSuccessfulStageRollover(): void {
  const snapshot: ReviewSessionSnapshot = {
    ids: ['former-current-case'],
    cursor: 0,
    filters: { ...DEFAULT_REVIEW_SESSION_FILTERS, stageSource: 'current' },
    assessments: {},
  }
  const stageContextAfterRollover = {
    liveStages: [
      ...REVIEW_STAGE_CONTEXT.liveStages.slice(0, 2),
      {
        ...REVIEW_STAGE_CONTEXT.liveStages[2]!,
        status: 'archived' as const,
        endsOn: '2026-08-21',
        archivedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: 'stage-next',
        sequence: 4,
        name: '下一阶段',
        status: 'current' as const,
        startsOn: '2026-08-22',
        endsOn: null,
        createdAt: '2026-08-22T00:00:00.000Z',
        archivedAt: null,
      },
    ],
    currentLiveStageId: 'stage-next',
  }

  const restored = reconcileReviewSession(
    snapshot,
    [{ ...baseTrade, id: 'former-current-case', tradeKind: 'case', liveStageId: 'stage-current' }],
    new Set(),
    FIXED_TRADING_DAY_KEY,
    FIXED_TRADING_DAY_START_HOUR,
    stageContextAfterRollover,
  )

  assert(restored?.ids.join(',') === 'former-current-case', '阶段交接只改变阶段状态时不得取消进行中的当前阶段轮次')
  assert(restored?.filters.stageSource === 'current', 'rollover 保活不得改写用户为下一轮保存的阶段来源')
}

export function testReviewAssessmentSchedulesFromBusinessDayBeforeAndAfterBoundary(): void {
  const reviewCase = { ...baseTrade, id: 'business-day-case', tradeKind: 'case' } as Trade
  const beforeBoundary = new Date(2026, 7, 12, 5, 30)
  const afterBoundary = new Date(2026, 7, 12, 6, 30)
  const beforeUnfamiliar = buildReviewAssessmentPatch(reviewCase, 'unfamiliar', beforeBoundary, 6)
  const beforeRecheck = buildReviewAssessmentPatch(reviewCase, 'recheck', beforeBoundary, 6)
  const afterUnfamiliar = buildReviewAssessmentPatch(reviewCase, 'unfamiliar', afterBoundary, 6)
  const afterRecheck = buildReviewAssessmentPatch(reviewCase, 'recheck', afterBoundary, 6)

  assert(beforeUnfamiliar.nextReviewAt === '2026-08-14', '起始小时前的不熟悉必须按前一业务日 +3')
  assert(beforeRecheck.nextReviewAt === '2026-08-18', '起始小时前的待复看必须按前一业务日 +7')
  assert(afterUnfamiliar.nextReviewAt === '2026-08-15', '起始小时后的不熟悉必须按当前业务日 +3')
  assert(afterRecheck.nextReviewAt === '2026-08-19', '起始小时后的待复看必须按当前业务日 +7')
}

export function testReviewSessionStorageFailuresDegradeSafely(): void {
  const corrupt = new MemoryStorage()
  corrupt.setItem(reviewSessionStorageKey('library-a'), '{bad json')
  assert(loadReviewSession('library-a', corrupt) === null, '损坏数据应忽略并回到开始面板')
  assert(corrupt.getItem(reviewSessionStorageKey('library-a')) === null, '损坏数据应安全清除')

  const unavailable = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('quota') },
    removeItem: () => { throw new Error('blocked') },
  }
  const snapshot: ReviewSessionSnapshot = {
    ids: ['live-1'],
    cursor: 0,
    filters: DEFAULT_REVIEW_SESSION_FILTERS,
    assessments: {},
  }
  assert(!saveReviewSession('library-a', snapshot, unavailable), '配额失败不得中断会话')
  assert(loadReviewSession('library-a', unavailable) === null, '不可用存储应降级为无恢复能力')
  assert(!clearReviewSessionStorage('library-a', unavailable), '清理失败不得向整库恢复流程抛错')
}

export function testReviewSessionStorageClearIsScopedToCurrentLibrary(): void {
  const storage = new MemoryStorage()
  const snapshot: ReviewSessionSnapshot = {
    ids: ['live-1'],
    cursor: 0,
    filters: DEFAULT_REVIEW_SESSION_FILTERS,
    assessments: {},
  }
  saveReviewSession('library-a', snapshot, storage)
  saveReviewSession('library-b', snapshot, storage)

  assert(clearReviewSessionStorage('library-a', storage), '当前资料库会话应可安全清理')
  assert(loadReviewSession('library-a', storage) === null, '整库恢复后不得恢复旧队列')
  assert(loadReviewSession('library-b', storage) !== null, '清理不得影响其他资料库的隔离会话')
}

export function testReviewSessionRestoreDropsUnavailableRecordsWithoutLosingCurrentCard(): void {
  const snapshot: ReviewSessionSnapshot = {
    ids: ['deleted', 'case-1', 'live-1', 'missing'],
    cursor: 2,
    filters: { ...DEFAULT_REVIEW_SESSION_FILTERS, includeAccountTrades: true },
    assessments: { deleted: 'mastered', 'case-1': 'recheck' },
  }
  const trades: Trade[] = [
    { ...baseTrade, id: 'deleted', deletedAt: '2026-07-16T00:00:00.000Z' },
    { ...baseTrade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' },
    baseTrade,
  ]

  const restored = reconcileReviewSession(
    snapshot,
    trades,
    new Set(),
    FIXED_TRADING_DAY_KEY,
    FIXED_TRADING_DAY_START_HOUR,
    REVIEW_STAGE_CONTEXT,
  )

  assert(restored?.ids.join(',') === 'case-1,live-1', '恢复时应剔除删除或不存在的记录')
  assert(restored?.cursor === 1, '剔除前序记录后仍应停留在同一张卡')
  assert(restored?.assessments['case-1'] === 'recheck', '有效记录的本轮评估应保留')
  assert(restored?.assessments.deleted === undefined, '失效记录的评估应一并剔除')
}

export function testReviewSessionFiltersPersistIndependentlyOfActiveRound(): void {
  const storage = new MemoryStorage()
  const filters = {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includePaperTrades: true,
    includeLiveTrades: false,
    requireContent: true,
    reviewTiming: 'all' as const,
    stageSource: 'current' as const,
  }

  assert(saveReviewSessionFilters('prefs-library', filters, storage), '复盘设置必须可独立保存')
  assert(
    storage.getItem(reviewSessionFiltersStorageKey('prefs-library')) !== null,
    '复盘设置必须写入独立键，不得占用活动轮次会话',
  )
  const restored = loadReviewSessionFilters('prefs-library', storage)
  assert(restored?.includePaperTrades === true, '记住的设置必须恢复模拟盘开关')
  assert(restored?.includeLiveTrades === false, '记住的设置必须恢复实盘开关')
  assert(restored?.requireContent === true, '记住的设置必须恢复有效图文开关')
  assert(restored?.reviewTiming === 'all', '记住的设置必须恢复案例时间范围')
  assert(restored?.stageSource === 'current', '记住的设置必须恢复阶段来源')
  assert(loadReviewSession('prefs-library', storage) === null, '只记设置时不得伪造活动轮次')

  storage.setItem(reviewSessionFiltersStorageKey('corrupt-prefs'), '{bad json')
  assert(loadReviewSessionFilters('corrupt-prefs', storage) === null, '损坏的设置必须安全丢弃')
  assert(storage.getItem(reviewSessionFiltersStorageKey('corrupt-prefs')) === null, '损坏设置应被清除')

  assert(clearReviewSessionFilters('prefs-library', storage), '记住的设置应可按资料库清理')
  assert(loadReviewSessionFilters('prefs-library', storage) === null, '清理后不得残留设置')
}

export function testReviewSessionIsAValidDetailReturnForCasesAndTrades(): void {
  for (const tradeKind of ['case', 'live', 'paper'] as const) {
    const target = resolveTradeDetailReturn({
      from: { pathname: '/review-session', search: '' },
      tradeKind,
    })
    assert(target.pathname === '/review-session', `${tradeKind} 详情应返回随机复盘`)
  }
}

// Quality-Scenario: LS-REVIEW-DEFAULT

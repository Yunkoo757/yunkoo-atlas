import type { Trade } from '@/data/trades'
import { resolveTradeDetailReturn } from '@/lib/tradeRoute'
import {
  DEFAULT_REVIEW_SESSION_FILTERS,
  buildReviewAssessmentPatch,
  buildReviewSessionPool,
  clearReviewSessionStorage,
  loadReviewSession,
  reconcileReviewSession,
  reviewFiltersForNextRound,
  reviewSessionStorageKey,
  saveReviewSession,
  shuffleReviewSessionIds,
  getReviewSessionContent,
  type ReviewSessionSnapshot,
} from '@/lib/reviewSession'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const baseTrade: Trade = {
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
}

const FIXED_TRADING_DAY_KEY = '2026-08-11'
const FIXED_TRADING_DAY_START_HOUR = 6

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
  )

  assert(
    pool.map((trade) => trade.id).join(',') === 'loose-month,slash-date,natural-language,overflowing-iso',
    '严格且日历有效的远期 legacy ISO datetime 必须被解析并排除，其他宽松或溢出日期必须视为到期',
  )
}

export function testReviewSessionDefaultPoolIncludesCasesOnly(): void {
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

  const defaultPool = buildReviewSessionPool(trades, DEFAULT_REVIEW_SESSION_FILTERS, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR)
  assert(defaultPool.map((trade) => trade.id).join(',') === 'case-1',
    '默认随机复盘池只能包含案例')

  const expandedPool = buildReviewSessionPool(trades, {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includeAccountTrades: true,
  }, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR)
  assert(expandedPool.map((trade) => trade.id).join(',') === 'live-1,paper-1,case-1',
    '复盘设置仍应允许显式加入账户交易')
}

export function testReviewSessionAccountTradesRequireClosedReviewedContent(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'eligible' },
    { ...baseTrade, id: 'open', status: 'open', closedAt: null },
    { ...baseTrade, id: 'unreviewed', reviewStatus: 'unreviewed' },
    { ...baseTrade, id: 'empty', note: '<p>&nbsp;</p>' },
    {
      ...baseTrade,
      id: 'missed',
      status: 'missed',
      pnl: null,
      rMultiple: null,
      note: '<p>犹豫导致错过</p>',
    },
  ]

  const pool = buildReviewSessionPool(trades, {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includeAccountTrades: true,
  }, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR)

  assert(pool.map((trade) => trade.id).join(',') === 'eligible,missed',
    '账户交易必须已结束、已正式复盘且有有效内容才可进入随机复盘')
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

  const pool = buildReviewSessionPool(trades, filters, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR)

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

export function testReviewSessionCaseScopeUsesSharedStarredFocusRule(): void {
  const cases: Trade[] = [
    { ...baseTrade, id: 'starred-case', ref: 'CAS-1', tradeKind: 'case' },
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
  }, new Set(['starred-case']), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR)

  assert(pool.map((trade) => trade.id).join(',') === 'starred-case',
    '重点 scope 应与案例页一致地包含星标案例')
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
  }, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR)

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
  assert(reviewSessionStorageKey('library-a').includes(':v2:'), '会话存储键必须包含版本')

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
  ], nextFilters, new Set(), FIXED_TRADING_DAY_KEY, FIXED_TRADING_DAY_START_HOUR)
  assert(nextRoundPool.map((trade) => trade.id).join() === 'today-case', '旧轮后的新轮必须排除未来与已掌握案例')
  assert(
    reviewFiltersForNextRound({ ...legacy, restoredLegacyReviewTiming: undefined }).reviewTiming === 'all',
    '显式选择 all 的现代轮次结束后必须保留用户筛选，不能被 legacy 兼容逻辑重置',
  )
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
  )

  assert(restored?.ids.join(',') === 'case-1,live-1', '恢复时应剔除删除或不存在的记录')
  assert(restored?.cursor === 1, '剔除前序记录后仍应停留在同一张卡')
  assert(restored?.assessments['case-1'] === 'recheck', '有效记录的本轮评估应保留')
  assert(restored?.assessments.deleted === undefined, '失效记录的评估应一并剔除')
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

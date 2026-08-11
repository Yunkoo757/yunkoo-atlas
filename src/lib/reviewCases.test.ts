import type { Trade } from '@/data/trades'
import { buildReviewCaseFromTrade } from '@/lib/reviewCases'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const source = {
  id: 'source-1', ref: 'TRD-1', symbol: 'BTCUSDT', side: 'long', status: 'win',
  conviction: 'medium', strategyId: 'strategy', tags: [], mistakeTags: [],
  reviewStatus: 'reviewed', reviewCategory: 'normal', tradeKind: 'live',
  entry: 100, exit: 110, size: 1, pnl: 10, rMultiple: 1, resultSource: 'imported',
  openedAt: '2026-07-31', closedAt: '2026-07-31', note: '<p>最新来源复盘</p>',
} satisfies Trade

export function testReviewCaseStartsWithSourceSnapshotAndEmptyCaseNote(): void {
  const reviewCase = buildReviewCaseFromTrade(source, { id: 'case-1', ref: 'CAS-1' })
  assert(reviewCase.sourceNoteHtml === source.note, '案例必须保存来源快照')
  assert(reviewCase.note === '', '案例沉淀正文必须独立且初始为空')
  assert(reviewCase.sourceTradeId === source.id, '案例必须保持来源关联')
  assert(!reviewCase.note.includes('来源交易：'), '系统来源行不得混入案例沉淀正文')
}

export function testMissedSourceCreatesMissedCaseThroughClassificationBoundary(): void {
  const reviewCase = buildReviewCaseFromTrade(
    {
      ...source,
      status: 'missed',
      reviewCategory: 'mistake',
      reviewStatus: 'reviewed',
      mistakeTags: ['冲动追单'],
    },
    { id: 'case-missed', ref: 'CAS-2' },
  )

  assert(reviewCase.status === 'missed', '错过来源提炼后必须保持 missed 状态')
  assert(reviewCase.caseType === 'missed', '错过来源提炼后必须归类为 missed 案例')
  assert(reviewCase.masteryState === 'new', '新案例必须从 new 掌握状态开始')
  assert(Boolean(reviewCase.nextReviewAt), '新案例必须带有预定的下次复看日期')
  assert(reviewCase.reviewCategory === 'normal', '兼容分类必须由 missed/new 的统一真值派生')
  assert(reviewCase.reviewStatus === 'unreviewed', '兼容状态必须由 missed/new 的统一真值派生')
}

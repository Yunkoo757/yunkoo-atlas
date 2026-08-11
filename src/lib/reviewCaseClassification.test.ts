import type { Trade } from '@/data/trades'
import { applyCaseClassificationMutation, containsCaseClassificationMutation } from '@/lib/reviewCaseClassification'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const caseTrade: Trade = {
  id: 'case-1',
  ref: 'CAS-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  tradeKind: 'case',
  caseType: 'exemplar',
  masteryState: 'new',
  nextReviewAt: '2026-08-14',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 10,
  rMultiple: 1,
  openedAt: '2026-08-11',
  closedAt: '2026-08-11',
  note: '',
}

export function testCaseClassificationTruthTable(): void {
  const cases = [
    ['new', 'exemplar', 'normal', 'unreviewed'],
    ['new', 'mistake', 'mistake', 'unreviewed'],
    ['new', 'ambiguous', 'ambiguous', 'unreviewed'],
    ['new', 'missed', 'normal', 'unreviewed'],
    ['recheck', 'exemplar', 'recheck', 'unreviewed'],
    ['recheck', 'mistake', 'recheck', 'unreviewed'],
    ['recheck', 'ambiguous', 'recheck', 'unreviewed'],
    ['recheck', 'missed', 'recheck', 'unreviewed'],
    ['mastered', 'exemplar', 'mastered', 'reviewed'],
    ['mastered', 'mistake', 'mastered', 'reviewed'],
    ['mastered', 'ambiguous', 'mastered', 'reviewed'],
    ['mastered', 'missed', 'mastered', 'reviewed'],
  ] as const
  for (const [masteryState, caseType, reviewCategory, reviewStatus] of cases) {
    const result = applyCaseClassificationMutation(caseTrade, { masteryState, caseType })
    assert(result.trade.reviewCategory === reviewCategory, `${masteryState}/${caseType} 分类镜像错误`)
    assert(result.trade.reviewStatus === reviewStatus, `${masteryState}/${caseType} 状态镜像错误`)
  }
}

export function testCaseTypeMutationReclassifiesWithoutChangingMasteryOrDate(): void {
  const result = applyCaseClassificationMutation(caseTrade, { caseType: 'ambiguous' })

  assert(result.ok && result.changed, '案例类型变更必须成功且标记为变化')
  assert(result.trade !== caseTrade, '成功的案例分类变更必须返回新交易对象')
  assert(result.trade.caseType === 'ambiguous', '案例类型变更必须写入案例类型')
  assert(result.trade.masteryState === 'new', '仅变更案例类型不得改写掌握状态')
  assert(result.trade.nextReviewAt === '2026-08-14', '仅变更案例类型不得改写复习日期')
  assert(result.trade.reviewCategory === 'ambiguous', '案例类型变更必须重新镜像分类')
  assert(result.trade.reviewStatus === 'unreviewed', '案例类型变更必须重新镜像状态')
}

export function testDateMutationPreservesClassificationAndAcceptsExplicitUndefined(): void {
  const source = { ...caseTrade, caseType: 'mistake' as const, masteryState: 'recheck' as const, reviewCategory: 'recheck' as const }
  const scheduled = applyCaseClassificationMutation(source, { nextReviewAt: '2026-08-20' })
  const unscheduled = applyCaseClassificationMutation(source, { nextReviewAt: undefined })

  assert(scheduled.ok && scheduled.changed, '仅变更复习日期必须成功且标记为变化')
  assert(scheduled.trade.nextReviewAt === '2026-08-20', '仅变更复习日期必须写入指定日期')
  assert(scheduled.trade.caseType === 'mistake' && scheduled.trade.masteryState === 'recheck', '仅变更复习日期不得改写案例语义')
  assert(scheduled.trade.reviewCategory === 'recheck' && scheduled.trade.reviewStatus === 'unreviewed', '仅变更复习日期不得改写分类镜像')
  assert(unscheduled.ok && unscheduled.changed, '显式 undefined 复习日期必须被识别为分类变更')
  assert('nextReviewAt' in unscheduled.trade && unscheduled.trade.nextReviewAt === undefined, '显式 undefined 必须保留为明确的未排期值')
}

export function testMistakeTagsDoNotDetermineCaseClassification(): void {
  const result = applyCaseClassificationMutation(
    { ...caseTrade, mistakeTags: ['冲动追单'], reviewCategory: 'mistake' },
    { caseType: 'exemplar' },
  )

  assert(result.ok, '案例分类变更必须成功')
  assert(result.trade.reviewCategory === 'normal', '错误标签不得覆盖案例类型决定的分类')
  assert(result.trade.reviewStatus === 'unreviewed', '错误标签不得覆盖案例状态镜像')
}

export function testAccountTradesAreRejectedWithoutMutation(): void {
  const accountTrade = { ...caseTrade, id: 'live-1', ref: 'TRD-1', tradeKind: 'live' as const }
  const result = applyCaseClassificationMutation(accountTrade, { caseType: 'mistake' })

  assert(!result.ok, '账户交易不得进入案例分类边界')
  assert(result.code === 'review-case-classification-forbidden', '账户交易拒绝必须提供稳定错误码')
  assert(result.reason === 'account-trade-forbidden', '账户交易拒绝必须说明原因')
  assert(!result.changed && result.trade === accountTrade, '账户交易拒绝必须保持零修改')
}

export function testLegacyFocusPromotionIsLimitedToOriginalFocusCases(): void {
  const categoryFocus = applyCaseClassificationMutation(
    { ...caseTrade, reviewCategory: 'focus' },
    { caseType: 'exemplar' },
  )
  const statusFocus = applyCaseClassificationMutation(
    { ...caseTrade, reviewStatus: 'focus' },
    { caseType: 'exemplar' },
  )
  const ordinary = applyCaseClassificationMutation(caseTrade, { caseType: 'exemplar' })

  assert(categoryFocus.promoteLegacyFocusToStar, '旧版 focus 分类必须请求迁移为收藏')
  assert(statusFocus.promoteLegacyFocusToStar, '旧版 focus 状态必须请求迁移为收藏')
  assert(!ordinary.promoteLegacyFocusToStar, '非 focus 案例不得请求迁移为收藏')
}

export function testEmptyMutationPreservesCaseContentWithoutLegacyFocusPromotion(): void {
  const legacyFocusCase = { ...caseTrade, reviewCategory: 'focus' as const, reviewStatus: 'focus' as const }
  const ordinary = applyCaseClassificationMutation(caseTrade, {})
  const legacyFocus = applyCaseClassificationMutation(legacyFocusCase, {})

  assert(ordinary.ok && !ordinary.changed, '普通案例的空 mutation 必须是未变化操作')
  assert(JSON.stringify(ordinary.trade) === JSON.stringify(caseTrade), '普通案例的空 mutation 不得改写交易内容')
  assert(!ordinary.promoteLegacyFocusToStar, '普通案例的空 mutation 不得请求迁移为收藏')
  assert(legacyFocus.ok && !legacyFocus.changed, '旧版 focus 案例的空 mutation 必须是未变化操作')
  assert(JSON.stringify(legacyFocus.trade) === JSON.stringify(legacyFocusCase), '旧版 focus 案例的空 mutation 不得改写兼容字段')
  assert(!legacyFocus.promoteLegacyFocusToStar, '旧版 focus 案例的空 mutation 不得请求迁移为收藏')
}

export function testContainsCaseClassificationMutationUsesOnlyOwnClassificationProperties(): void {
  const inheritedCaseType = Object.create({ caseType: 'mistake' }) as Record<string, unknown>

  assert(!containsCaseClassificationMutation({}), '空对象不得被识别为案例分类 mutation')
  assert(containsCaseClassificationMutation({ caseType: undefined }), 'own caseType 即使为 undefined 也必须被识别')
  assert(containsCaseClassificationMutation({ masteryState: undefined }), 'own masteryState 即使为 undefined 也必须被识别')
  assert(containsCaseClassificationMutation({ nextReviewAt: undefined }), 'own nextReviewAt 即使为 undefined 也必须被识别')
  assert(!containsCaseClassificationMutation({ reviewCategory: 'focus' }), '不相关字段不得被识别为案例分类 mutation')
  assert(!containsCaseClassificationMutation(inheritedCaseType), '原型链字段不得被识别为案例分类 mutation')
}

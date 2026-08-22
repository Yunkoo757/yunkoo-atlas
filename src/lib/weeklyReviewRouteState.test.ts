import {
  buildWeeklyReviewSearch,
  resolveWeeklyReviewRouteState,
} from '@/lib/weeklyReviewRouteState'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const currentWeek = '2026-07-27'
const historyWeek = '2026-07-20'
const availableWeeks = [currentWeek, historyWeek]

export function testWeeklyReviewRouteUsesCompactCanonicalDefaults(): void {
  const result = resolveWeeklyReviewRouteState('', { currentWeek, availableWeeks })
  assert(result.state.selectedWeek === currentWeek, '默认地址必须使用当前周')
  assert(result.state.tab === 'review', '默认地址必须使用复盘详情')
  assert(result.canonicalSearch === '', '默认状态不得产生查询参数')
  assert(!result.needsReplace, '规范默认地址不得重复 replace')

  const explicitDefaults = resolveWeeklyReviewRouteState(
    `?week=${currentWeek}&tab=review&visual=mobile`,
    { currentWeek, availableWeeks },
  )
  assert(explicitDefaults.canonicalSearch === '?visual=mobile', '默认参数必须压缩并保留 visual')
  assert(explicitDefaults.needsReplace, '冗余默认参数必须被替换')
}

export function testWeeklyReviewRouteRestoresHistoryAndYearTab(): void {
  const result = resolveWeeklyReviewRouteState(
    `?tab=year&week=${historyWeek}&visual=desktop`,
    { currentWeek, availableWeeks },
  )
  assert(result.state.selectedWeek === historyWeek, '有效历史周必须保持固定')
  assert(result.state.tab === 'year', '年度趋势页签必须恢复')
  assert(
    result.canonicalSearch === `?week=${historyWeek}&tab=year&visual=desktop`,
    '规范地址必须按 week、tab、其他参数的稳定顺序输出',
  )
}

export function testWeeklyReviewRouteCleansInvalidOwnedParamsOnly(): void {
  const result = resolveWeeklyReviewRouteState(
    '?week=2026-07-22&tab=unknown&visual=mobile&fixture=route',
    { currentWeek, availableWeeks },
  )
  assert(result.state.selectedWeek === currentWeek, '不可用周必须回退当前周')
  assert(result.state.tab === 'review', '非法页签必须回退复盘详情')
  assert(
    result.canonicalSearch === '?fixture=route&visual=mobile',
    '纠正只能清理 week 和 tab，并稳定保留其他参数',
  )
}

export function testWeeklyReviewRouteRejectsInvalidCalendarDatesAndNonMondayMembers(): void {
  const invalidMembers = ['2026-02-30', '2026-07-22']

  for (const requestedWeek of invalidMembers) {
    const result = resolveWeeklyReviewRouteState(
      `?week=${requestedWeek}&visual=mobile`,
      { currentWeek, availableWeeks: [currentWeek, ...invalidMembers] },
    )
    assert(
      result.state.selectedWeek === currentWeek,
      `${requestedWeek} 即使存在于 availableWeeks 也不得成为有效周起始日`,
    )
    assert(
      result.canonicalSearch === '?visual=mobile',
      `${requestedWeek} 必须从规范地址中移除并保留无关参数`,
    )
  }
}

export function testWeeklyReviewRouteTemporarilyAdmitsOnlyTheVerifiedReturnWeek(): void {
  const unavailableReturnWeek = '2026-07-13'
  const verifiedReturnOptions = {
    currentWeek,
    availableWeeks,
    verifiedReturnWeek: unavailableReturnWeek,
  }
  const restored = resolveWeeklyReviewRouteState(
    `?week=${unavailableReturnWeek}&tab=year`,
    verifiedReturnOptions,
  )
  assert(restored.state.selectedWeek === unavailableReturnWeek, '已验证返回请求必须临时放行原周')
  assert(restored.state.tab === 'year', '已验证返回请求必须同时保留原页签')
  assert(
    restored.canonicalSearch === `?week=${unavailableReturnWeek}&tab=year`,
    '放行后的原周与页签必须保持为可恢复地址',
  )

  const ordinaryDeepLink = resolveWeeklyReviewRouteState(
    `?week=${unavailableReturnWeek}&tab=year`,
    { currentWeek, availableWeeks },
  )
  assert(ordinaryDeepLink.state.selectedWeek === currentWeek, '没有返回上下文的不可用周仍须回退当前周')
  assert(ordinaryDeepLink.canonicalSearch === '?tab=year', '普通深链必须清理不可用 week')
}

export function testWeeklyReviewRouteBuildersPreserveUnrelatedParams(): void {
  const historySearch = buildWeeklyReviewSearch(
    '?visual=mobile&fixture=route',
    { selectedWeek: historyWeek, tab: 'review' },
    currentWeek,
  )
  assert(historySearch === `?week=${historyWeek}&fixture=route&visual=mobile`, '历史周地址错误')

  const yearSearch = buildWeeklyReviewSearch(
    historySearch,
    { selectedWeek: historyWeek, tab: 'year' },
    currentWeek,
  )
  assert(
    yearSearch === `?week=${historyWeek}&tab=year&fixture=route&visual=mobile`,
    '年度趋势写回不得丢失历史周或其他参数',
  )
}

export function testWeeklyReviewRouteFollowsRolloverUnlessHistoryIsPinned(): void {
  const nextCurrentWeek = '2026-08-03'
  const nextAvailableWeeks = [nextCurrentWeek, currentWeek, historyWeek]
  const defaultResult = resolveWeeklyReviewRouteState('', {
    currentWeek: nextCurrentWeek,
    availableWeeks: nextAvailableWeeks,
  })
  assert(defaultResult.state.selectedWeek === nextCurrentWeek, '默认地址跨周后必须跟随新当前周')

  const pinnedResult = resolveWeeklyReviewRouteState(`?week=${historyWeek}`, {
    currentWeek: nextCurrentWeek,
    availableWeeks: nextAvailableWeeks,
  })
  assert(pinnedResult.state.selectedWeek === historyWeek, '显式历史周跨周后必须保持固定')

  const unavailableResult = resolveWeeklyReviewRouteState('?week=2026-07-13', {
    currentWeek: nextCurrentWeek,
    availableWeeks: nextAvailableWeeks,
  })
  assert(unavailableResult.state.selectedWeek === nextCurrentWeek, '不可用的合法周日期必须回退当前周')
}

export function testWeeklyReviewRouteDeepLinksSameWeekReviewsByStableIdentity(): void {
  const reviews = [
    { id: 'review-current-stage', weekStart: historyWeek, liveStageId: 'stage-current' },
    { id: 'review-old-stage', weekStart: historyWeek, liveStageId: 'stage-old' },
  ]
  const explicitHistorical = resolveWeeklyReviewRouteState(
    `?week=${historyWeek}&review=review-old-stage`,
    {
      currentWeek,
      availableWeeks,
      availableReviews: reviews,
      currentLiveStageId: 'stage-current',
    },
  )
  assert(explicitHistorical.state.selectedWeek === historyWeek, '显式历史复盘必须恢复所属周')
  assert(explicitHistorical.state.selectedReviewId === 'review-old-stage', '同周历史复盘必须按稳定 ID 恢复')
  assert(
    explicitHistorical.canonicalSearch === `?week=${historyWeek}&review=review-old-stage`,
    '同周历史复盘规范地址必须保留稳定 ID',
  )

  const roundTrip = resolveWeeklyReviewRouteState(explicitHistorical.canonicalSearch, {
    currentWeek,
    availableWeeks,
    availableReviews: reviews,
    currentLiveStageId: 'stage-current',
  })
  assert(roundTrip.state.selectedReviewId === 'review-old-stage', '刷新/重挂载后不得切回同周其他阶段')
}

export function testWeeklyReviewLegacyWeekOnlyRoutePrefersCurrentStageReview(): void {
  const reviews = [
    { id: 'review-old-stage', weekStart: historyWeek, liveStageId: 'stage-old' },
    { id: 'review-current-stage', weekStart: historyWeek, liveStageId: 'stage-current' },
  ]
  const result = resolveWeeklyReviewRouteState(`?week=${historyWeek}`, {
    currentWeek,
    availableWeeks,
    availableReviews: reviews,
    currentLiveStageId: 'stage-current',
  })
  assert(result.state.selectedReviewId === 'review-current-stage', '旧 week-only 地址必须优先当前阶段复盘')
  assert(
    result.canonicalSearch === `?week=${historyWeek}&review=review-current-stage`,
    '旧 week-only 地址必须升级为无歧义规范地址',
  )
}

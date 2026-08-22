import type { Trade } from '@/data/trades'
import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPolicyVersion,
  WeeklyRiskPreparation,
} from '@/data/riskManagement'
import type { WeeklyReview } from '@/data/weeklyReviews'
import { assertValidLiveStageState, type LiveStage } from '@/lib/liveStages'

export type StageOwnershipEntityType =
  | 'live-trade'
  | 'missed-trade'
  | 'case-trade'
  | 'weekly-review'
  | 'weekly-risk-preparation'
  | 'risk-policy-version'
  | 'monthly-risk-limit'
  | 'risk-override-event'

export interface StageOwnershipRepairState {
  liveStages: LiveStage[]
  currentLiveStageId: string
  trades: Trade[]
  weeklyReviews: WeeklyReview[]
  weeklyRiskPreparations: WeeklyRiskPreparation[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
}

export interface PendingStageOwnershipContext {
  label: string
  value: string
}

export interface PendingStageOwnershipSource {
  label: string
  id: string
  reference?: string
  title?: string
}

export interface PendingStageOwnershipItem {
  entityType: StageOwnershipEntityType
  entityId: string
  reference: string
  title: string
  context: PendingStageOwnershipContext[]
  source?: PendingStageOwnershipSource
  reason: string
  fingerprint: string
}

export interface AssignPendingStageOwnershipRequest {
  entityType: StageOwnershipEntityType
  entityId: string
  liveStageId: string
  /** UI 捕获待整理项时的完整实体指纹；变化后拒绝覆盖并要求刷新。 */
  expectedFingerprint?: string
}

export type StageOwnershipRepairErrorCode =
  | 'entity-not-found'
  | 'wrong-entity-type'
  | 'already-assigned'
  | 'paper-trade'
  | 'invalid-ownership'
  | 'target-stage-not-found'
  | 'target-stage-invalid'
  | 'ownership-conflict'
  | 'stale-request'

export class StageOwnershipRepairError extends Error {
  constructor(
    readonly code: StageOwnershipRepairErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StageOwnershipRepairError'
  }
}

type StageOwnedEntity =
  | Exclude<Trade, { tradeKind: 'paper' }>
  | WeeklyReview
  | WeeklyRiskPreparation
  | RiskPolicyVersion
  | MonthlyRiskLimit
  | RiskOverrideEvent

type StageOwnedSlice = Exclude<keyof StageOwnershipRepairState, 'liveStages' | 'currentLiveStageId'>

interface LocatedEntity {
  entityType: StageOwnershipEntityType
  slice: StageOwnedSlice
  entity: StageOwnedEntity
}

const MIGRATION_REASON = '旧版迁移无法可靠归属；系统保留原始数据，未根据日期猜测目标阶段。'

export const STAGE_OWNERSHIP_ENTITY_LABELS: Record<StageOwnershipEntityType, string> = {
  'live-trade': '实盘交易',
  'missed-trade': '错过机会',
  'case-trade': '案例',
  'weekly-review': '周复盘',
  'weekly-risk-preparation': '周风险准备',
  'risk-policy-version': '风险政策版本',
  'monthly-risk-limit': '月度风险限额',
  'risk-override-event': '风险覆盖记录',
}

function fingerprint(entity: StageOwnedEntity, source?: PendingStageOwnershipSource): string {
  return JSON.stringify(source === undefined ? entity : { entity, source })
}

function tradeEntityType(trade: Trade): StageOwnershipEntityType | null {
  if (trade.tradeKind === 'paper') return null
  if (trade.tradeKind === 'case') return 'case-trade'
  return trade.status === 'missed' ? 'missed-trade' : 'live-trade'
}

function tradeSource(state: StageOwnershipRepairState, trade: Trade): PendingStageOwnershipSource | undefined {
  if (trade.tradeKind !== 'case' || !trade.sourceTradeId) return undefined
  const source = state.trades.find((candidate) => candidate.id === trade.sourceTradeId)
  return {
    label: '来源交易',
    id: trade.sourceTradeId,
    ...(source ? { reference: source.ref, title: source.symbol } : {}),
  }
}

function tradeContext(trade: Trade): PendingStageOwnershipContext[] {
  return [
    { label: '开仓/记录日期', value: trade.openedAt },
    ...(trade.recordedAt ? [{ label: '收录时间', value: trade.recordedAt }] : []),
    ...(trade.closedAt ? [{ label: '平仓日期', value: trade.closedAt }] : []),
    ...(trade.status === 'missed' && trade.missReason ? [{ label: '错过原因', value: trade.missReason }] : []),
  ]
}

function tradeItem(state: StageOwnershipRepairState, trade: Exclude<Trade, { tradeKind: 'paper' }>): PendingStageOwnershipItem {
  const entityType = tradeEntityType(trade)
  if (!entityType) throw new Error('paper 不属于阶段实体')
  const source = tradeSource(state, trade)
  return {
    entityType,
    entityId: trade.id,
    reference: trade.ref,
    title: `${trade.symbol} · ${STAGE_OWNERSHIP_ENTITY_LABELS[entityType]}`,
    context: tradeContext(trade),
    source,
    reason: MIGRATION_REASON,
    fingerprint: fingerprint(trade, source),
  }
}

function sourceById(
  label: string,
  id: string | null | undefined,
  reference?: string,
  title?: string,
): PendingStageOwnershipSource | undefined {
  if (!id) return undefined
  return { label, id, ...(reference ? { reference } : {}), ...(title ? { title } : {}) }
}

function itemForLocated(state: StageOwnershipRepairState, located: LocatedEntity): PendingStageOwnershipItem {
  const { entity, entityType } = located
  if ('tradeKind' in entity) return tradeItem(state, entity)
  switch (entityType) {
    case 'weekly-review': {
      const review = entity as WeeklyReview
      return {
        entityType,
        entityId: review.id,
        reference: review.id,
        title: `周复盘 · ${review.weekStart} 至 ${review.weekEnd}`,
        context: [
          { label: '周起始', value: review.weekStart },
          { label: '周结束', value: review.weekEnd },
          { label: '状态', value: review.status },
          { label: '最后更新', value: review.updatedAt },
        ],
        reason: MIGRATION_REASON,
        fingerprint: fingerprint(review),
      }
    }
    case 'weekly-risk-preparation': {
      const preparation = entity as WeeklyRiskPreparation
      return {
        entityType,
        entityId: preparation.id,
        reference: preparation.id,
        title: `周风险准备 · ${preparation.weekStart}`,
        context: [
          { label: '周起始', value: preparation.weekStart },
          { label: '最后更新', value: preparation.updatedAt },
        ],
        source: sourceById('已确认政策版本', preparation.confirmedPolicyVersionId),
        reason: MIGRATION_REASON,
        fingerprint: fingerprint(preparation),
      }
    }
    case 'risk-policy-version': {
      const policy = entity as RiskPolicyVersion
      return {
        entityType,
        entityId: policy.id,
        reference: policy.id,
        title: `风险政策 · ${policy.effectiveTradingDay}`,
        context: [
          { label: '来源周', value: policy.sourceWeekStart },
          { label: '生效交易日', value: policy.effectiveTradingDay },
          { label: '确认时间', value: policy.confirmedAt },
        ],
        reason: MIGRATION_REASON,
        fingerprint: fingerprint(policy),
      }
    }
    case 'monthly-risk-limit': {
      const limit = entity as MonthlyRiskLimit
      return {
        entityType,
        entityId: limit.id,
        reference: limit.id,
        title: `月度风险限额 · ${limit.monthKey}`,
        context: [
          { label: '月份', value: limit.monthKey },
          { label: '锁定时间', value: limit.lockedAt },
        ],
        source: sourceById('来源政策版本', limit.sourcePolicyVersionId),
        reason: MIGRATION_REASON,
        fingerprint: fingerprint(limit),
      }
    }
    case 'risk-override-event': {
      const override = entity as RiskOverrideEvent
      const sourceTrade = state.trades.find((trade) => trade.id === override.tradeId)
      const source = sourceById(
        '关联交易',
        override.tradeId,
        sourceTrade?.ref ?? override.tradeIdentityAtDecision.ref,
        sourceTrade?.symbol ?? override.tradeIdentityAtDecision.symbol,
      )
      return {
        entityType,
        entityId: override.id,
        reference: override.id,
        title: `风险覆盖 · ${override.tradeIdentityAtDecision.ref}`,
        context: [
          { label: '决策交易日', value: override.tradingDayKeyAtDecision },
          { label: '创建时间', value: override.createdAt },
          { label: '覆盖原因', value: override.reason },
          ...(override.policyVersionId ? [{ label: '政策版本', value: override.policyVersionId }] : []),
        ],
        source,
        reason: MIGRATION_REASON,
        fingerprint: fingerprint(override, source),
      }
    }
    case 'live-trade':
    case 'missed-trade':
    case 'case-trade':
      throw new Error('交易实体分派失败')
  }
}

function allLocatedEntities(state: StageOwnershipRepairState): LocatedEntity[] {
  const trades = state.trades.flatMap((trade): LocatedEntity[] => {
    const entityType = tradeEntityType(trade)
    if (!entityType || trade.tradeKind === 'paper') return []
    return [{ entityType, slice: 'trades', entity: trade }]
  })
  return [
    ...trades,
    ...state.weeklyReviews.map((entity): LocatedEntity => ({ entityType: 'weekly-review', slice: 'weeklyReviews', entity })),
    ...state.weeklyRiskPreparations.map((entity): LocatedEntity => ({ entityType: 'weekly-risk-preparation', slice: 'weeklyRiskPreparations', entity })),
    ...state.riskPolicyVersions.map((entity): LocatedEntity => ({ entityType: 'risk-policy-version', slice: 'riskPolicyVersions', entity })),
    ...state.monthlyRiskLimits.map((entity): LocatedEntity => ({ entityType: 'monthly-risk-limit', slice: 'monthlyRiskLimits', entity })),
    ...state.riskOverrideEvents.map((entity): LocatedEntity => ({ entityType: 'risk-override-event', slice: 'riskOverrideEvents', entity })),
  ]
}

export function listPendingStageOwnership(state: StageOwnershipRepairState): PendingStageOwnershipItem[] {
  return allLocatedEntities(state)
    .filter(({ entity }) => entity.liveStageId === null)
    .map((located) => itemForLocated(state, located))
}

function locateForAssignment(
  state: StageOwnershipRepairState,
  request: AssignPendingStageOwnershipRequest,
): LocatedEntity {
  const sameId = allLocatedEntities(state).filter(({ entity }) => entity.id === request.entityId)
  const matchingEntities = sameId.filter(({ entityType }) => entityType === request.entityType)
  if (matchingEntities.length > 1) {
    throw new StageOwnershipRepairError('stale-request', '待整理项标识不唯一，请刷新或重新导入资料')
  }
  const matching = matchingEntities[0]
  if (!matching) {
    if (sameId.length > 0) {
      throw new StageOwnershipRepairError('wrong-entity-type', '待整理项类型已变化，请刷新后重试')
    }
    const paper = state.trades.find((candidate) => candidate.id === request.entityId && candidate.tradeKind === 'paper')
    if (paper && ['live-trade', 'missed-trade', 'case-trade'].includes(request.entityType)) {
      throw new StageOwnershipRepairError('paper-trade', '模拟交易不属于实盘阶段')
    }
    throw new StageOwnershipRepairError('entity-not-found', '待整理项已不存在，请刷新后重试')
  }
  return matching
}

function validateTargetStage(state: StageOwnershipRepairState, targetId: string): void {
  if (!state.liveStages.some((stage) => stage.id === targetId)) {
    throw new StageOwnershipRepairError('target-stage-not-found', '目标阶段已不存在，请重新选择')
  }
  try {
    assertValidLiveStageState({
      liveStages: state.liveStages,
      currentLiveStageId: state.currentLiveStageId,
    })
  } catch {
    throw new StageOwnershipRepairError('target-stage-invalid', '目标阶段资料无效，无法保存归属')
  }
}

function validateTargetPeriodAvailability(
  state: StageOwnershipRepairState,
  located: LocatedEntity,
  targetId: string,
): void {
  let occupied = false
  switch (located.entityType) {
    case 'weekly-review': {
      const entity = located.entity as WeeklyReview
      occupied = state.weeklyReviews.some((candidate) => (
        candidate.id !== entity.id &&
        candidate.liveStageId === targetId &&
        candidate.weekStart === entity.weekStart
      ))
      break
    }
    case 'weekly-risk-preparation': {
      const entity = located.entity as WeeklyRiskPreparation
      occupied = state.weeklyRiskPreparations.some((candidate) => (
        candidate.id !== entity.id &&
        candidate.liveStageId === targetId &&
        candidate.weekStart === entity.weekStart
      ))
      break
    }
    case 'monthly-risk-limit': {
      const entity = located.entity as MonthlyRiskLimit
      occupied = state.monthlyRiskLimits.some((candidate) => (
        candidate.id !== entity.id &&
        candidate.liveStageId === targetId &&
        candidate.monthKey === entity.monthKey
      ))
      break
    }
    case 'live-trade':
    case 'missed-trade':
    case 'case-trade':
    case 'risk-policy-version':
    case 'risk-override-event':
      break
  }
  if (occupied) {
    throw new StageOwnershipRepairError(
      'ownership-conflict',
      '目标阶段已有同周期实体，请先核对已有记录或选择其他阶段',
    )
  }
}

function replaceOwnership<T extends { id: string; liveStageId?: string | null }>(
  records: T[],
  entityId: string,
  liveStageId: string,
): T[] {
  return records.map((entity) => entity.id === entityId ? { ...entity, liveStageId } : entity)
}

function replaceTradeOwnership(records: Trade[], entityId: string, liveStageId: string): Trade[] {
  return records.map((trade) => (
    trade.id === entityId && trade.tradeKind !== 'paper'
      ? { ...trade, liveStageId }
      : trade
  ))
}

export function assignPendingStageOwnership<T extends StageOwnershipRepairState>(
  state: T,
  request: AssignPendingStageOwnershipRequest,
): T {
  const located = locateForAssignment(state, request)
  if (located.entity.liveStageId === undefined) {
    throw new StageOwnershipRepairError('invalid-ownership', '实体仍是未迁移 schema 状态，不能静默修复')
  }
  if (located.entity.liveStageId !== null) {
    throw new StageOwnershipRepairError('already-assigned', '实体已经完成阶段归属，请刷新后核对')
  }
  if (
    request.expectedFingerprint !== undefined &&
    request.expectedFingerprint !== itemForLocated(state, located).fingerprint
  ) {
    throw new StageOwnershipRepairError('stale-request', '待整理项在选择后发生变化，请刷新上下文再保存')
  }
  validateTargetStage(state, request.liveStageId)
  validateTargetPeriodAvailability(state, located, request.liveStageId)

  switch (located.slice) {
    case 'trades':
      return { ...state, trades: replaceTradeOwnership(state.trades, request.entityId, request.liveStageId) } as T
    case 'weeklyReviews':
      return { ...state, weeklyReviews: replaceOwnership(state.weeklyReviews, request.entityId, request.liveStageId) } as T
    case 'weeklyRiskPreparations':
      return { ...state, weeklyRiskPreparations: replaceOwnership(state.weeklyRiskPreparations, request.entityId, request.liveStageId) } as T
    case 'riskPolicyVersions':
      return { ...state, riskPolicyVersions: replaceOwnership(state.riskPolicyVersions, request.entityId, request.liveStageId) } as T
    case 'monthlyRiskLimits':
      return { ...state, monthlyRiskLimits: replaceOwnership(state.monthlyRiskLimits, request.entityId, request.liveStageId) } as T
    case 'riskOverrideEvents':
      return { ...state, riskOverrideEvents: replaceOwnership(state.riskOverrideEvents, request.entityId, request.liveStageId) } as T
  }
}

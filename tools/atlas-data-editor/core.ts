import { decodeCanonicalSnapshot, type CanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { assertValidPersistedSnapshot } from '../../src/storage/snapshotValidation'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { createInitialLiveStage } from '../../src/lib/liveStages'
import { stripRetiredSnapshotDomains } from '../../src/storage/retiredSnapshotDomains'
import { withoutLegacyStageFields } from '../../src/lib/stageMigration'
import { formatYmd } from '../../src/lib/periods'

export { SCHEMA_VERSION }

type EditorSnapshot = CanonicalSnapshot & Record<string, unknown>

export function addTagPresets(snapshot: EditorSnapshot, key: 'tagPresets' | 'mistakeTagPresets', text: string) {
  const tags = text.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean)
  if (!tags.length) throw new Error('请输入标签名称。')
  const next = structuredClone(snapshot)
  next[key] = [...new Set([...(next[key] ?? []), ...tags])]
  if (next[key].length === (snapshot[key] ?? []).length) throw new Error('这些标签已经存在。')
  validate(next)
  return next
}

export function assignStrategy(snapshot: EditorSnapshot, ids: ReadonlySet<string>, strategyId: string) {
  if (!ids.size) throw new Error('请先选择交易记录。')
  if (!snapshot.strategies.some(strategy => strategy.id === strategyId)) throw new Error('策略不存在。')
  const next = structuredClone(snapshot)
  for (const trade of next.trades) if (ids.has(trade.id)) trade.strategyId = strategyId
  validate(next)
  return next
}

export function decode(raw: object, version: number): EditorSnapshot {
  const canonical = decodeCanonicalSnapshot(raw, { version, label: '离线编辑器' })
  const retained = withoutLegacyStageFields(stripRetiredSnapshotDomains(raw))
  return { ...retained, ...canonical }
}

export function validate(snapshot: unknown) {
  assertValidPersistedSnapshot(snapshot, '资料库')
  decode(snapshot, SCHEMA_VERSION)
  for (const [key, value] of Object.entries(snapshot)) {
    if (!Array.isArray(value)) continue
    const ids = value.filter(x => x && typeof x === 'object' && 'id' in x).map(x => x.id)
    if (new Set(ids).size !== ids.length) throw new Error(`${key} 存在重复 ID`)
  }
}

export function migrateToPaper(snapshot: EditorSnapshot, ids: ReadonlySet<string>) {
  const next = structuredClone(snapshot)
  for (const trade of next.trades) {
    if (!ids.has(trade.id)) continue
    trade.tradeKind = 'paper'
    Reflect.deleteProperty(trade, 'liveStageId')
  }
  // Direct weekly links require live records. Frozen historical evidence stays intact.
  for (const review of next.weeklyReviews ?? []) {
    for (const key of ['highlightTradeIds', 'mistakeTradeIds', 'followUpTradeIds'] as const) {
      review[key] = review[key].filter(id => !ids.has(id))
    }
  }
  validate(next)
  return next
}

export function resetLive(snapshot: EditorSnapshot) {
  if (snapshot.trades.some(trade => trade.tradeKind === 'live')) {
    throw new Error('请先将剩余实盘日志迁入模拟盘，再重置阶段；案例无需迁移。')
  }
  const next = structuredClone(snapshot)
  const now = new Date()
  const day = formatYmd(now)
  const stage = createInitialLiveStage(day, now.toISOString(), crypto.randomUUID())
  next.liveStages = [stage]
  next.currentLiveStageId = stage.id
  next.scheduledStageRollover = null
  // Cases remain in the case library; null is Atlas's valid unassigned stage.
  for (const trade of next.trades) if (trade.tradeKind === 'case') trade.liveStageId = null
  for (const key of ['weeklyReviews', 'weeklyRiskPreparations', 'riskPolicyVersions', 'monthlyRiskLimits', 'riskOverrideEvents'] as const) next[key] = []
  validate(next)
  return next
}

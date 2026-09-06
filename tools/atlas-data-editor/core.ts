import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { assertValidPersistedSnapshot } from '../../src/storage/snapshotValidation'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { createInitialLiveStage } from '../../src/lib/liveStages'

export { SCHEMA_VERSION }
export function addTagPresets(snapshot: any, key: 'tagPresets' | 'mistakeTagPresets', text: string) {
  const tags = text.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean)
  if (!tags.length) throw new Error('请输入标签名称。')
  const next = structuredClone(snapshot)
  next[key] = [...new Set([...(next[key] ?? []), ...tags])]
  if (next[key].length === (snapshot[key] ?? []).length) throw new Error('这些标签已经存在。')
  validate(next)
  return next
}
export function assignStrategy(snapshot: any, ids: Set<string>, strategyId: string) {
  if (!ids.size) throw new Error('请先选择交易记录。')
  if (!snapshot.strategies.some((s: any) => s.id === strategyId)) throw new Error('策略不存在。')
  const next = structuredClone(snapshot)
  for (const trade of next.trades) if (ids.has(trade.id)) trade.strategyId = strategyId
  validate(next)
  return next
}
export function decode(raw: any, version: number) {
  // Keep extension fields, while applying Atlas's own migrations and defaults.
  const decoded = { ...raw, ...decodeCanonicalSnapshot(raw, { version, label: '离线编辑器' }) }
  delete decoded.livePerformanceCycles
  delete decoded.liveStatsStartTradingDayKey
  return decoded
}
export function validate(snapshot: any) {
  assertValidPersistedSnapshot(snapshot, '资料库')
  decode(snapshot, SCHEMA_VERSION)
  for (const [key, value] of Object.entries(snapshot)) {
    if (!Array.isArray(value)) continue
    const ids = value.filter(x => x && typeof x === 'object' && 'id' in x).map(x => x.id)
    if (new Set(ids).size !== ids.length) throw new Error(`${key} 存在重复 ID`)
  }
}
export function migrateToPaper(snapshot: any, ids: Set<string>) {
  const next = structuredClone(snapshot)
  for (const trade of next.trades) {
    if (!ids.has(trade.id)) continue
    trade.tradeKind = 'paper'
    delete trade.liveStageId
  }
  // Direct weekly links require live records. Frozen historical evidence stays intact.
  for (const review of next.weeklyReviews ?? []) {
    for (const key of ['highlightTradeIds', 'mistakeTradeIds', 'followUpTradeIds']) {
      review[key] = review[key].filter((id: string) => !ids.has(id))
    }
  }
  validate(next)
  return next
}
export function resetLive(snapshot: any) {
  if (snapshot.trades.some((t: any) => t.tradeKind === 'live')) {
    throw new Error('请先将剩余实盘日志迁入模拟盘，再重置阶段；案例无需迁移。')
  }
  const next = structuredClone(snapshot)
  const now = new Date()
  const day = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const stage = createInitialLiveStage(day, now.toISOString(), crypto.randomUUID())
  next.liveStages = [stage]
  next.currentLiveStageId = stage.id
  next.scheduledStageRollover = null
  // Cases remain in the case library; null is Atlas's valid unassigned stage.
  for (const trade of next.trades) if (trade.tradeKind === 'case') trade.liveStageId = null
  for (const key of ['weeklyReviews', 'weeklyRiskPreparations', 'riskPolicyVersions', 'monthlyRiskLimits', 'riskOverrideEvents']) next[key] = []
  validate(next)
  return next
}

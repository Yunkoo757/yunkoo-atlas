import { recordJudgment, undoJudgment, attemptComparison } from './assessment'
import { assertJudgmentDesk, emptyJudgmentDesk, type JudgmentDeskData } from './model'
import { collectAssetIdsFromSnapshot } from '@/storage/assets'
import { buildAssetInventory } from '@/storage/assetInventory'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import { SCHEMA_VERSION } from '@/storage/types'
import { prepareImportPayloadForCommit, buildExportPayloadFromState, parseImportJson, serializeJsonExportPayload } from '@/lib/importExport'
import { mergeImportPayload } from '@/lib/importMerge'
import { applySnapshotToStore, resetEmptyLibraryIntoStore } from '@/lib/snapshotStore'
import { useStore } from '@/store/useStore'
import { pickPersisted } from '@/storage/persist'
import { resolveTradeDetailReturn } from '@/lib/tradeRoute'
import { resolveTradeDetailSourceCopy } from '@/views/detailSourceCopy'

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
export function testJudgmentSourceRoundTripKeepsItsOwnReturnDestination() {
  for (const tradeKind of ['live', 'paper', 'case'] as const) {
    const destination = resolveTradeDetailReturn({ from: { pathname: '/judgment-desk' }, tradeKind })
    const copy = resolveTradeDetailSourceCopy({ returnPathname: destination.pathname, tradeKind })
    assert(destination.pathname === '/judgment-desk' && copy.backAriaLabel === '返回判断台', '查看来源后必须按原有返回操作回到判断台')
  }
}
export function judgmentFixture(): JudgmentDeskData {
  return { ...emptyJudgmentDesk(), themes: [{ id: 'theme', title: '4H 决策 POI 的边界', understanding: '仍在研究的假设' }], samples: [{
    id: 'sample', themeId: 'theme', title: '整体与局部', createdAt: '2026-09-19T00:00:00.000Z', images: [{ assetId: 'shared-image', sourceTradeId: null }],
    note: '', opinion: 'uncertain', reference: { answer: 'yes', reason: '人工确定', confirmedAt: '2026-09-19T00:00:00.000Z', needsReview: false },
  }], currentThemeId: 'theme', currentSampleId: 'sample' }
}
export function testHistoryFreezesReferenceAndUnderstandingAndUndoIsScoped() {
  const initial = judgmentFixture(), trained = recordJudgment(initial, 'sample', 'yes', 'attempt', '2026-09-20T00:00:00Z')
  trained.samples[0].reference!.answer = 'no'; trained.themes[0].understanding = '新认识'
  assert(trained.attempts[0].reference!.answer === 'yes', '历史参考不能跟随修改')
  assert(trained.attempts[0].understanding === '仍在研究的假设', '历史认识必须冻结')
  assert(attemptComparison(trained.attempts[0]) === '与当时参考判断一致', '按历史参考比较')
  const undone = undoJudgment(trained, 'attempt')
  assert(undone.attempts.length === 0 && undone.samples[0].opinion === 'uncertain', '撤销恢复前次判断')
  const newer = recordJudgment(trained, 'sample', 'no', 'newer', '2026-09-21T00:00:00Z')
  assert(undoJudgment(newer, 'attempt') === newer, '不能撤销已被后续判断覆盖的记录')
  const stale = judgmentFixture(); stale.samples[0].reference!.needsReview = true
  assert(attemptComparison(recordJudgment(stale, 'sample', 'yes', 'stale', '2026-09-22T00:00:00Z').attempts[0]) === '与上次判断不同', '待确认参考不评分')
}
export function testSampleOwnsAssetEvenAfterSourceDeletion() {
  const snapshot = { trades: [], judgmentDesk: judgmentFixture() }
  assert(collectAssetIdsFromSnapshot(snapshot).includes('shared-image'), '无来源交易时素材仍为 GC root')
  const inventory = buildAssetInventory(snapshot, [{ id: 'shared-image', state: 'healthy', source: 'committed' }])
  assert(inventory.orphan.length === 0 && inventory.healthy[0].domains.includes('judgmentDesk'), '盘点必须保护判断图')
  const removed = { ...snapshot, judgmentDesk: emptyJudgmentDesk() }
  assert(buildAssetInventory(removed, inventory.physical).orphan.length === 1, '最后引用删除后才成为孤立资产')
}
export function testJudgmentCodecRejectsCorruptEvidenceAndMigratesOldSnapshot() {
  const old = createFullPersistedSnapshotFixture(); delete old.judgmentDesk
  assert(decodeCanonicalSnapshot(old, { version: 13 }).judgmentDesk.samples.length === 0, 'v13 补齐空判断台')
  for (const mutate of [(d: JudgmentDeskData) => { d.samples[0].images[0].assetId = '../bad' }, (d: JudgmentDeskData) => { d.samples[0].themeId = 'missing' }, (d: JudgmentDeskData) => { d.samples.push(d.samples[0]) }]) {
    const data = judgmentFixture(); mutate(data); let rejected = false
    try { assertJudgmentDesk(data) } catch { rejected = true }
    assert(rejected, '损坏证据必须拒绝，不得默默丢弃')
  }
}
export async function testJudgmentExportImportRemapsAssetsAndKeepsSharedIdentity() {
  const snapshot = createFullPersistedSnapshotFixture()
  snapshot.trades = []; snapshot.weeklyReviews = []; snapshot.quickNotes = []; snapshot.judgmentDesk = judgmentFixture()
  const asset = { id: 'shared-image', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO6sAAAAASUVORK5CYII=' }
  const exported = await buildExportPayloadFromState(snapshot, async id => id === asset.id ? asset : null)
  assert(exported.assets?.length === 1, '仅被判断台引用的图必须导出')
  const result = parseImportJson(serializeJsonExportPayload(exported))
  assert(result.ok, '含判断台 JSON 必须可解析')
  const prepared = prepareImportPayloadForCommit(exported, () => 'remapped-image')
  assert(prepared.payload.judgmentDesk!.samples[0].images[0].assetId === 'remapped-image', '导入必须改写样本资产 ID')
  const local = decodeCanonicalSnapshot(snapshot, { version: SCHEMA_VERSION })
  const merged = mergeImportPayload(local, prepared.payload, 'judgment-test')
  assert(merged.judgmentDesk!.samples.length === 2, '合并保留本地与导入的独立结论')
  const twice = mergeImportPayload({ ...local, ...merged }, prepared.payload, 'judgment-test')
  assert(twice.judgmentDesk!.samples.length === 2, '重复导入不重复样本')
  applySnapshotToStore({ ...snapshot, judgmentDesk: prepared.payload.judgmentDesk })
  assert(pickPersisted(useStore.getState()).judgmentDesk.samples[0].images[0].assetId === 'remapped-image', 'hydrate 到 autosave 全链保留')
  resetEmptyLibraryIntoStore()
  assert(useStore.getState().judgmentDesk.samples.length === 0, '切换空库不可泄露上一库素材')
}

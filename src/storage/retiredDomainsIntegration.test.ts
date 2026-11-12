import JSZip from 'jszip'
import { buildExportPayloadFromState, buildWebConflictRecoveryPayload, buildWebJournalArchiveBlob, parseImportJson, prepareImportPayloadForCommit, serializeJsonExportPayload } from '@/lib/importExport'
import { mergeImportPayload } from '@/lib/importMerge'
import { applySnapshotToStore } from '@/lib/snapshotStore'
import { collectAssetIdsFromSnapshot } from './assets'
import { buildAssetInventory } from './assetInventory'
import { createFullPersistedSnapshotFixture, FULL_SNAPSHOT_ASSET_IDS } from './fixtures/fullPersistedSnapshot'
import { PERSISTED_SNAPSHOT_FIELDS } from './persistedKeys'
import { decodeCanonicalSnapshot } from './snapshotCodec'
import { SCHEMA_VERSION } from './types'
import { useStore } from '@/store/useStore'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO6sAAAAASUVORK5CYII='
const asset = (id: string) => ({ id, mime: 'image/png', data: imageData })

async function legacyPayload() {
  const snapshot = createFullPersistedSnapshotFixture()
  const exported = await buildExportPayloadFromState(snapshot, async id => asset(id))
  return {
    ...exported,
    judgmentDesk: {
      samples: [{ images: [{ assetId: FULL_SNAPSHOT_ASSET_IDS.shared }, { assetId: 'retired-sample-only' }] }],
      attempts: [{ evidence: { images: [{ assetId: 'retired-history-only' }] } }],
    },
    reviewComposer: { unsupportedLegacyState: true },
    assets: [...exported.assets!, asset('retired-sample-only'), asset('retired-history-only')],
  }
}

export function testLegacyCodecDropsRetiredFieldsWithoutValidatingOrMutatingTheirContents(): void {
  const snapshot = createFullPersistedSnapshotFixture()
  const legacy = { ...snapshot, judgmentDesk: { invalid: '../never-load-this' }, reviewComposer: 'invalid obsolete engine state' }
  for (const version of [13, 14, SCHEMA_VERSION]) {
    const decoded = decodeCanonicalSnapshot(legacy, { version })
    assert(!('judgmentDesk' in decoded) && !('reviewComposer' in decoded), '退役域不得出现在任何旧版本的活跃快照中')
    assert(JSON.stringify(decoded.trades) === JSON.stringify(snapshot.trades), '退役不得改写交易和案例')
    assert(JSON.stringify(decoded.weeklyReviews) === JSON.stringify(snapshot.weeklyReviews), '退役不得改写周复盘')
  }
  assert('judgmentDesk' in legacy && legacy.reviewComposer === 'invalid obsolete engine state', '读取应保持输入文件原样')
  assert(!PERSISTED_SNAPSHOT_FIELDS.some(key => String(key) === 'judgmentDesk' || String(key) === 'reviewComposer'), '持久化合同不得继续声明退役域')
}

export async function testPortableWritersCannotReviveRetiredStateOrNavigationOverrides(): Promise<void> {
  const snapshot = createFullPersistedSnapshotFixture()
  const legacy = {
    ...snapshot,
    judgmentDesk: { obsolete: true }, reviewComposer: { obsolete: true },
    shortcuts: { 'nav.list': null, 'nav.judgmentDesk': null, 'nav.reviewComposer': null, 'judgment.yes': null },
    display: { ...snapshot.display, sidebarPrimaryOrder: ['judgmentDesk', 'trades', 'reviewComposer', 'reviewSession'] },
  }
  const cleanText = (value: unknown) => !/judgmentDesk|reviewComposer|judgment\.|judgment-desk|review-composer/.test(JSON.stringify(value))
  const assets = Object.values(FULL_SNAPSHOT_ASSET_IDS).map(asset)
  const json = JSON.parse(serializeJsonExportPayload({ ...legacy, version: SCHEMA_VERSION, assets }))
  assert(cleanText(json), 'JSON writer不得回写退役状态或导航覆盖')
  const blob = buildWebJournalArchiveBlob(legacy as typeof snapshot, assets)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const archived = JSON.parse(await zip.file('data.json')!.async('string'))
  assert(cleanText(archived), 'Web ZIP直接writer不得回写旧状态或导航覆盖')
  const recovery = await buildWebConflictRecoveryPayload(legacy as typeof snapshot, async id => asset(id))
  assert(cleanText(recovery.payload), '冲突抢救导出不得通过raw snapshot展开复活旧状态')
  assert(JSON.stringify(recovery.payload.trades) === JSON.stringify(snapshot.trades), '抢救导出不得改写交易证据')
  const corruptedRetiredNavigation = { ...legacy, shortcuts: { ...legacy.shortcuts, 'judgment.yes': true }, display: {
    ...legacy.display, sidebarWorkspaceItems: [{ id: 'old-workspace', target: { kind: 'system', id: 'judgmentDesk' } }],
  } }
  const decoded = decodeCanonicalSnapshot(corruptedRetiredNavigation, { version: 14 })
  assert(cleanText(decoded), '旧退役导航应先丢弃，不得在现行合同校验前挡住旧包读取')
}

export async function testLegacyJsonImportDropsOnlyRetiredStateAndExclusiveAssets(): Promise<void> {
  const legacy = await legacyPayload()
  const result = parseImportJson(JSON.stringify(legacy))
  assert(result.ok, '旧JSON包含退役状态和专属图片时仍应兼容导入')
  assert(!('judgmentDesk' in result.data) && !('reviewComposer' in result.data), 'JSON reader必须丢弃专属状态')
  assert(result.data.assets!.some(item => item.id === FULL_SNAPSHOT_ASSET_IDS.shared), '交易、周复盘和随记共享图必须保留')
  assert(!result.data.assets!.some(item => item.id.startsWith('retired-')), '退役样本和冻结历史专属图不应继续导入')
  let nextId = 0
  const prepared = prepareImportPayloadForCommit(legacy, () => `active-import-${++nextId}`)
  assert(!('judgmentDesk' in prepared.payload) && !('reviewComposer' in prepared.payload), '直接准备旧payload也不得带回退役字段')
  assert(prepared.assets.length === Object.keys(FULL_SNAPSHOT_ASSET_IDS).length, '仅保留并重映射现行业务所需附件')
  const local = decodeCanonicalSnapshot(createFullPersistedSnapshotFixture(), { version: SCHEMA_VERSION })
  const merged = mergeImportPayload(local, prepared.payload, 'isolated-retired-domains')
  assert(!('judgmentDesk' in merged) && !('reviewComposer' in merged), '合并结果不得带回退役字段')
  const serialized = JSON.parse(serializeJsonExportPayload(legacy)) as Record<string, unknown>
  assert(!('judgmentDesk' in serialized) && !('reviewComposer' in serialized), '旧对象重新导出后也必须剥离专属状态')
  assert(!(serialized.assets as Array<{ id: string }>).some(item => item.id.startsWith('retired-')), '导出声明不得残留专属附件')
  const invalid = parseImportJson(JSON.stringify({ ...legacy, assets: [...legacy.assets, asset('unrelated-orphan')] }))
  assert(!invalid.ok, '普通未知孤立图片仍须拒绝，不能借退役放松损坏包门禁')
}

export async function testRetiredStateCannotProtectOrRemoveSharedBusinessReferences(): Promise<void> {
  const legacy = await legacyPayload()
  const referenced = collectAssetIdsFromSnapshot(legacy)
  assert(referenced.includes(FULL_SNAPSHOT_ASSET_IDS.shared), '现行业务共享图必须仍计引用')
  assert(!referenced.includes('retired-sample-only') && !referenced.includes('retired-history-only'), '退役状态必须退出引用GC')
  const inventory = buildAssetInventory(legacy, legacy.assets.map(item => ({ id: item.id, state: 'healthy' as const, source: 'committed' as const })))
  assert(inventory.orphan.map(item => item.id).sort().join() === 'retired-history-only,retired-sample-only', '仅专属图成为孤立候选，不得误伤交易、周复盘或随记图')
  const exported = await buildExportPayloadFromState({ ...legacy, ...decodeCanonicalSnapshot(legacy, { version: SCHEMA_VERSION }) }, async id => asset(id))
  assert(!('judgmentDesk' in exported) && !('reviewComposer' in exported), '活跃导出对象不得泄漏旧专属状态')
  assert(exported.assets!.length === Object.keys(FULL_SNAPSHOT_ASSET_IDS).length, '活跃导出仅含现行业务引用附件')
  const previous = useStore.getState()
  try {
    const snapshot = decodeCanonicalSnapshot(legacy, { version: SCHEMA_VERSION })
    applySnapshotToStore({ ...snapshot, weeklyReviews: [], riskOverrideEvents: [] })
    const state = useStore.getState()
    assert(!('judgmentDesk' in state) && !('reviewComposer' in state) && !('updateJudgmentDesk' in state), 'Store不得保留退役state/action')
    state.removeTrade(state.trades[0].id)
    assert(useStore.getState().purgeTrades([state.trades[0].id]).purgedIds.length === 1, '退役判断引用不得继续阻止正常交易删除')
  } finally { useStore.setState(previous, true) }
}

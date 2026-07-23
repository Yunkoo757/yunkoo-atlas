import { buildAssetInventory, RICH_TEXT_ASSET_DOMAINS } from '@/storage/assetInventory'
import type { PhysicalAssetRecord } from '@/storage/adapter'
import {
  createFullPersistedSnapshotFixture,
  FULL_SNAPSHOT_ASSET_IDS,
} from '@/storage/fixtures/fullPersistedSnapshot'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function record(
  id: string,
  state: PhysicalAssetRecord['state'],
  source: PhysicalAssetRecord['source'] = 'committed',
): PhysicalAssetRecord {
  return { id, state, source, declaredBytes: 10, actualBytes: state === 'missing' ? undefined : 10 }
}

export function testAssetInventoryDeduplicatesSharedReferencesAcrossAllRichTextDomains(): void {
  const snapshot = createFullPersistedSnapshotFixture()
  const records = [
    record(FULL_SNAPSHOT_ASSET_IDS.trade, 'healthy'),
    record(FULL_SNAPSHOT_ASSET_IDS.weeklyReview, 'missing'),
    record(FULL_SNAPSHOT_ASSET_IDS.quickNote, 'size-mismatch'),
    record(FULL_SNAPSHOT_ASSET_IDS.shared, 'healthy'),
    record('asset-orphan', 'healthy'),
    record('unreferenced-missing', 'missing'),
    record('../illegal', 'foreign', 'filesystem'),
    record('.asset.tmp', 'temp', 'filesystem'),
  ]

  const inventory = buildAssetInventory(snapshot, records)
  assert(inventory.referenced.length === 4, '共享附件必须按 ID 去重')
  const shared = inventory.referenced.find((item) => item.id === FULL_SNAPSHOT_ASSET_IDS.shared)
  assert(shared?.domains.join(',') === 'trade,weeklyReview,quickNote', '共享附件必须保留三个引用域')
  assert(inventory.healthy.length === 2, '仅健康且被引用的附件计入 healthy')
  assert(inventory.missing.map((item) => item.id).sort().join(',') === [
    FULL_SNAPSHOT_ASSET_IDS.quickNote,
    FULL_SNAPSHOT_ASSET_IDS.weeklyReview,
    'unreferenced-missing',
  ].sort().join(','), '缺文件与尺寸不符都必须报告为 missing，不能因无引用而消失')
  assert(inventory.orphan.map((item) => item.id).join(',') === 'asset-orphan', '健康未引用附件必须报告为 orphan')
  assert(inventory.foreign.map((item) => item.id).join(',') === '../illegal', '非法物理项必须隔离为 foreign')
  assert(inventory.temp.map((item) => item.id).join(',') === '.asset.tmp', '临时物理项必须独立报告')
  assert(inventory.physical.length === records.length, 'physical 必须保留完整物理扫描结果')
}

export function testRichTextAssetDomainsAreRegisteredInOneInventoryTable(): void {
  assert(
    RICH_TEXT_ASSET_DOMAINS.map((entry) => entry.domain).join(',') === 'trade,weeklyReview,quickNote',
    '三个当前富文本域必须通过统一注册表接入盘点',
  )
}
// Quality-Scenario: A-INVENTORY-SHARED

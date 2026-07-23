import type { PersistedSnapshot } from '@/storage/types'
import type { PhysicalAssetRecord } from '@/storage/adapter'
import { collectAssetIdsFromHtml } from '@/storage/assets'
import { isSafeAssetId } from '@/storage/assetId'

export interface AssetInventoryItem {
  id: string
  domains: AssetReferenceDomain[]
  record?: PhysicalAssetRecord
}

export type AssetReferenceDomain = 'trade' | 'weeklyReview' | 'quickNote'

/** 新增富文本域时只需在此注册其 HTML 选择器，盘点算法无需再复制扫描逻辑。 */
export const RICH_TEXT_ASSET_DOMAINS: ReadonlyArray<{
  domain: AssetReferenceDomain
  selectHtml(snapshot: Pick<PersistedSnapshot, 'trades' | 'weeklyReviews' | 'quickNotes'>): string[]
}> = [
  { domain: 'trade', selectHtml: (snapshot) => snapshot.trades.map((trade) => trade.note) },
  {
    domain: 'weeklyReview',
    selectHtml: (snapshot) => (snapshot.weeklyReviews ?? []).map((review) => review.contentHtml),
  },
  {
    domain: 'quickNote',
    selectHtml: (snapshot) => (snapshot.quickNotes ?? []).map((note) => note.contentHtml),
  },
]

export interface AssetInventory {
  physical: PhysicalAssetRecord[]
  referenced: AssetInventoryItem[]
  healthy: AssetInventoryItem[]
  missing: AssetInventoryItem[]
  orphan: PhysicalAssetRecord[]
  foreign: PhysicalAssetRecord[]
  temp: PhysicalAssetRecord[]
}

export function buildAssetInventory(
  snapshot: Pick<PersistedSnapshot, 'trades' | 'weeklyReviews' | 'quickNotes'>,
  physicalRecords: readonly PhysicalAssetRecord[],
): AssetInventory {
  const domainsById = new Map<string, Set<AssetReferenceDomain>>()
  const addDomain = (
    domain: AssetReferenceDomain,
    htmlEntries: readonly string[],
  ) => {
    for (const id of collectAssetIdsFromHtml(htmlEntries)) {
      const domains = domainsById.get(id) ?? new Set()
      domains.add(domain)
      domainsById.set(id, domains)
    }
  }
  for (const registration of RICH_TEXT_ASSET_DOMAINS) {
    addDomain(registration.domain, registration.selectHtml(snapshot))
  }

  const committedById = new Map<string, PhysicalAssetRecord>()
  const foreign: PhysicalAssetRecord[] = []
  const temp: PhysicalAssetRecord[] = []
  for (const record of physicalRecords) {
    if (record.state === 'temp' || record.source === 'prepared') {
      temp.push(record)
      continue
    }
    if (!isSafeAssetId(record.id) || record.state === 'foreign') {
      foreign.push(record)
      continue
    }
    if (!committedById.has(record.id)) committedById.set(record.id, record)
  }

  const referenced = [...domainsById.entries()].map(([id, domains]) => ({
    id,
    domains: [...domains],
    record: committedById.get(id),
  }))
  const healthy = referenced.filter((item) => item.record?.state === 'healthy')
  const missing = referenced.filter((item) => item.record?.state !== 'healthy')
  for (const record of committedById.values()) {
    if (
      !domainsById.has(record.id) &&
      (record.state === 'missing' || record.state === 'size-mismatch')
    ) {
      missing.push({ id: record.id, domains: [], record })
    }
  }
  const orphan = [...committedById.values()].filter(
    (record) => record.state === 'healthy' && !domainsById.has(record.id),
  )

  return { physical: [...physicalRecords], referenced, healthy, missing, orphan, foreign, temp }
}

import type { PersistedSnapshot } from '@/storage/types'
import type { PhysicalAssetRecord } from '@/storage/adapter'
import { htmlAssetIds, snapshotRichTextRecords } from '@/storage/snapshotRichText'
import { isSafeAssetId } from '@/storage/assetId'

export interface AssetInventoryItem {
  id: string
  domains: AssetReferenceDomain[]
  record?: PhysicalAssetRecord
}

export type AssetReferenceDomain = 'trade' | 'weeklyReview' | 'quickNote'

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
  for (const { domain, html } of snapshotRichTextRecords(snapshot)) {
    for (const id of htmlAssetIds(html)) {
      const domains = domainsById.get(id) ?? new Set<AssetReferenceDomain>()
      domains.add(domain)
      domainsById.set(id, domains)
    }
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

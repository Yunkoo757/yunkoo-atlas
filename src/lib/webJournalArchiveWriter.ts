import { base64ToBytes } from '@/lib/base64'
import { crc32 } from '@/lib/crc32'
import { isSafeAssetId } from '@/storage/assetId'
import { collectAssetIdsFromSnapshot } from '@/storage/snapshotRichText'
import { stripRetiredSnapshotDomains } from '@/storage/retiredSnapshotDomains'
import { SCHEMA_VERSION, type ExportAssetRecord, type PersistedSnapshot } from '@/storage/types'
import {
  MAX_WEB_JOURNAL_ARCHIVE_BYTES,
  MAX_WEB_JOURNAL_ENTRY_BYTES,
  MAX_WEB_JOURNAL_ENTRY_COUNT,
  MAX_WEB_JOURNAL_EXPANDED_BYTES,
  WEB_JOURNAL_EXPORT_VERSION,
  normalizeWebJournalImageMime,
  webJournalExtensionForMime,
} from './webJournalArchiveContract'

/**
 * 构建一个能被当前 Web 恢复器重新读取的完整归档。
 * 导出前即执行与解析器一致的附件类型、条目与容量检查，避免下载不可恢复的文件。
 */
export function buildWebJournalArchiveBlob(
  snapshot: PersistedSnapshot,
  assets: readonly ExportAssetRecord[],
  options: { recoveryOrphanAssetIds?: readonly string[] } = {},
): Blob {
  snapshot = stripRetiredSnapshotDomains(snapshot)
  const referencedIds = new Set(collectAssetIdsFromSnapshot(snapshot))
  const recoveryOrphanAssetIds = [...new Set(options.recoveryOrphanAssetIds ?? [])]
  for (const id of recoveryOrphanAssetIds) {
    if (!isSafeAssetId(id)) throw new Error(`无法创建 Web 归档：恢复附件 ID ${id} 无效。`)
  }
  const allowedIds = new Set([...referencedIds, ...recoveryOrphanAssetIds])
  const assetIds = new Set<string>()
  const normalizedAssets: Array<ExportAssetRecord & { extension: string }> = []

  for (const asset of assets) {
    if (!isSafeAssetId(asset.id)) {
      throw new Error('无法创建 Web 归档：附件 ID 无效。')
    }
    if (assetIds.has(asset.id)) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 重复。`)
    }
    const mime = normalizeWebJournalImageMime(asset.mime)
    const extension = webJournalExtensionForMime(mime)
    if (!mime || !extension) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 不是受支持的图片。`)
    }
    if (!allowedIds.has(asset.id)) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 未被任何笔记引用。`)
    }
    const normalized = { ...asset, mime, extension }
    assetIds.add(asset.id)
    normalizedAssets.push(normalized)
  }

  for (const id of referencedIds) {
    if (!isSafeAssetId(id) || !assetIds.has(id)) {
      throw new Error(`无法创建 Web 归档：笔记引用的附件 ${id} 缺失。`)
    }
  }

  for (const id of recoveryOrphanAssetIds) {
    if (!assetIds.has(id)) {
      throw new Error(`无法创建 Web 归档：恢复附件 ${id} 缺少声明或字节。`)
    }
  }

  if (normalizedAssets.length + 1 > MAX_WEB_JOURNAL_ENTRY_COUNT) {
    throw new Error(`无法创建 Web 归档：条目超过 ${MAX_WEB_JOURNAL_ENTRY_COUNT} 个。`)
  }

  // 元数据不含 base64，只保留附件声明；二进制写入 assets/。
  const meta = {
    ...snapshot,
    version: WEB_JOURNAL_EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    assets: normalizedAssets.map(({ id, mime }) => ({ id, mime })),
    ...(recoveryOrphanAssetIds.length > 0 ? { recoveryOrphanAssetIds } : {}),
  }
  const metaJson = new TextEncoder().encode(JSON.stringify(meta, null, 2))
  if (metaJson.byteLength > MAX_WEB_JOURNAL_ENTRY_BYTES) {
    throw new Error('无法创建 Web 归档：data.json 超过单文件容量限制。')
  }

  const entries: Array<{ name: string; data: Uint8Array<ArrayBuffer> }> = [
    { name: 'data.json', data: metaJson },
  ]
  let expandedBytes = metaJson.byteLength
  for (const asset of normalizedAssets) {
    if (asset.data.length > Math.ceil(MAX_WEB_JOURNAL_ENTRY_BYTES * 4 / 3) + 4) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 超过单文件容量限制。`)
    }
    let data: Uint8Array<ArrayBuffer>
    try {
      data = base64ToBytes(asset.data)
    } catch {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 的内容已损坏。`)
    }
    if (data.byteLength > MAX_WEB_JOURNAL_ENTRY_BYTES) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 超过单文件容量限制。`)
    }
    expandedBytes += data.byteLength
    if (expandedBytes > MAX_WEB_JOURNAL_EXPANDED_BYTES) {
      throw new Error('无法创建 Web 归档：归档解压后超过容量限制。')
    }
    entries.push({ name: `assets/${asset.id}.${asset.extension}`, data })
  }

  return buildZipBlob(entries)
}

// ---- minimal ZIP builder (stored, no compression) ----

function buildZipBlob(entries: { name: string; data: Uint8Array<ArrayBuffer> }[]): Blob {
  const encoder = new TextEncoder()
  const parts: Uint8Array<ArrayBuffer>[] = []
  const centralDir: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const localHeaderOffset = offset
    const crc = crc32(entry.data)

    // Local file header
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0, 0x04034b50, true)       // signature
    lv.setUint16(4, 20, true)                // version needed
    lv.setUint16(6, 0, true)                 // flags
    lv.setUint16(8, 0, true)                 // compression: stored
    lv.setUint16(10, 0, true)                // mod time
    lv.setUint16(12, 0, true)                // mod date
    lv.setUint32(14, crc, true)              // crc32
    lv.setUint32(18, entry.data.length, true) // compressed size
    lv.setUint32(22, entry.data.length, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)  // filename length
    lv.setUint16(28, 0, true)                 // extra field length
    localHeader.set(nameBytes, 30)
    parts.push(localHeader, entry.data)
    offset += localHeader.length + entry.data.length

    // Central directory entry
    const cdEntry = new Uint8Array(46 + nameBytes.length)
    const cdv = new DataView(cdEntry.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint16(8, 0, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint16(12, 0, true)
    cdv.setUint16(14, 0, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, entry.data.length, true)
    cdv.setUint32(24, entry.data.length, true)
    cdv.setUint16(28, nameBytes.length, true)
    cdv.setUint16(30, 0, true)
    cdv.setUint16(32, 0, true)
    cdv.setUint16(34, 0, true)
    cdv.setUint32(36, 0, true)
    cdv.setUint32(40, 0, true)
    cdv.setUint32(42, localHeaderOffset, true) // local header offset
    cdEntry.set(nameBytes, 46)
    centralDir.push(cdEntry)
  }

  const cdSize = centralDir.reduce((sum, p) => sum + p.length, 0)

  // End of central directory record
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)
  if (offset + cdSize + eocd.byteLength > MAX_WEB_JOURNAL_ARCHIVE_BYTES) {
    throw new Error('无法创建 Web 归档：压缩包超过容量限制。')
  }
  return new Blob([...parts, ...centralDir, eocd], { type: 'application/zip' })
}

import type { Trade } from '@/data/trades'
import type { ExportAssetRecord } from '@/storage/types'
import { collectAssetIdsFromHtml, remapHtmlAssetIds } from '@/storage/snapshotRichText'
import { mapTradeRichText, tradeRichTextEntries } from '@/storage/tradeRichText'
import { canonicalRiskJson } from '@/lib/riskFingerprint'

export type VerifyImportAsset = (incomingId: string, localId: string) => Promise<boolean>

/** 只在本次候选内复用比较结果；传输载荷已校验为规范 Base64，可直接比较完整字节。 */
export function verifyImportAssets(
  files: readonly ExportAssetRecord[], read: (id: string) => Promise<ExportAssetRecord | null>,
): VerifyImportAsset {
  const incoming = new Map(files.map(file => [file.id, file]))
  const checked = new Map<string, Map<string, boolean>>()
  return async (incomingId, localId) => {
    const file = incoming.get(incomingId)
    if (!file) return false
    let matches = checked.get(incomingId)
    if (!matches) {
      matches = new Map()
      checked.set(incomingId, matches)
    }
    const previous = matches.get(localId)
    if (previous !== undefined) return previous
    const local = await read(localId)
    const same = local?.id === localId && local.mime === file.mime && local.data === file.data
    matches.set(localId, same)
    return same
  }
}

function stableTradeIdentity(trade: Trade): Record<string, string> | null {
  const create = trade.activities
    ?.filter((activity) =>
      activity.kind === 'create' && activity.id && Number.isFinite(Date.parse(activity.timestamp)),
    )
    .sort((left, right) => {
      const timestampOrder = Date.parse(left.timestamp) - Date.parse(right.timestamp)
      return timestampOrder || left.id.localeCompare(right.id)
    })[0]
  if (!trade.id || !trade.ref || !trade.tradeKind || !create) return null
  return {
    id: trade.id,
    ref: trade.ref,
    tradeKind: trade.tradeKind,
    earliestCreateActivityId: create.id,
    earliestCreateActivityTimestamp: create.timestamp,
  }
}

/**
 * 有创建证据时允许同一交易更新正文。无创建证据时，所有字段都须相同；
 * 只有经逐字节核对的附件才可以用本地编号代入比较。
 */
export async function matchImportedTrade(
  local: Trade, incoming: Trade, verifyAsset?: VerifyImportAsset,
): Promise<'different' | 'same-origin' | 'identical'> {
  if (local.backtestProjectId !== incoming.backtestProjectId) return 'different'
  const left = stableTradeIdentity(local)
  const right = stableTradeIdentity(incoming)
  if (left && right) return canonicalRiskJson(left) === canonicalRiskJson(right) ? 'same-origin' : 'different'

  const sourceIds = verifyAsset ? collectAssetIdsFromHtml(tradeRichTextEntries(incoming)) : []
  if (!verifyAsset || !sourceIds.length) return canonicalRiskJson(local) === canonicalRiskJson(incoming) ? 'identical' : 'different'
  const localIds = collectAssetIdsFromHtml(tradeRichTextEntries(local))
  if (sourceIds.length !== localIds.length) return 'different'
  // 按首次出现位置一一对应，重复引用和图片顺序仍须通过完整正文比较。
  const targets = new Map(sourceIds.map((id, index) => [id, localIds[index]!]))
  const mapped = mapTradeRichText(incoming, html => remapHtmlAssetIds(html, id => targets.get(id)!))
  if (mapped.decisionImageId) mapped.decisionImageId = targets.get(mapped.decisionImageId) ?? mapped.decisionImageId
  if (canonicalRiskJson(local) !== canonicalRiskJson(mapped)) return 'different'
  for (const [id, target] of targets) {
    if (!await verifyAsset(id, target)) return 'different'
  }
  return 'identical'
}

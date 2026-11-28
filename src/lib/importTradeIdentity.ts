import type { Trade } from '@/data/trades'
import { isSafeAssetId } from '@/storage/assetId'
import type { ExportAssetRecord } from '@/storage/types'
import { collectAssetIdsFromHtml, remapHtmlAssetIds } from '@/storage/snapshotRichText'
import { mapTradeRichText, tradeRichTextEntries } from '@/storage/tradeRichText'
import { syncReviewCaseSourceNote } from '@/lib/reviewCaseSources'
import { OperationalError } from '@/lib/operationalError'
import { canonicalJsonEqual, stableRiskHash } from '@/lib/riskFingerprint'

export type VerifyImportAsset = (incomingId: string, localId: string) => Promise<boolean>

/** 只在本次候选内复用比较结果；传输载荷已校验为规范 Base64，可直接比较完整字节。 */
export function verifyImportAssets(
  files: readonly ExportAssetRecord[], read: (id: string) => Promise<ExportAssetRecord | null>,
): VerifyImportAsset {
  const incoming = new Map(files.map(file => [file.id, file]))
  const checked = new Map<string, Map<string, boolean>>()
  return async (incomingId, localId) => {
    const file = incoming.get(incomingId)
    if (!file || !isSafeAssetId(localId)) return false
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

/** 正文与来源快照共用同一组编号。完整正文比较仍会检查顺序、重复引用和标签。 */
function correspondingAssets(from: readonly string[], to: readonly string[]) {
  const incoming = collectAssetIdsFromHtml(from)
  const local = collectAssetIdsFromHtml(to)
  return incoming.length === local.length ? new Map(incoming.map((id, i) => [id, local[i]!])) : undefined
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
  if (left && right) return canonicalJsonEqual(left, right) ? 'same-origin' : 'different'

  if (!verifyAsset) return canonicalJsonEqual(local, incoming) ? 'identical' : 'different'
  const targets = correspondingAssets(tradeRichTextEntries(incoming), tradeRichTextEntries(local))
  if (!targets) return 'different'
  const mapped = mapTradeRichText(incoming, html => remapHtmlAssetIds(html, id => targets.get(id)!))
  if (mapped.decisionImageId) mapped.decisionImageId = targets.get(mapped.decisionImageId) ?? mapped.decisionImageId
  if (!canonicalJsonEqual(local, mapped)) return 'different'
  for (const [id, target] of targets) {
    if (!await verifyAsset(id, target)) return 'different'
  }
  return 'identical'
}

export function stableImportedTradeId(payloadDigest: string, sourceId: string): string {
  return `imported:${stableRiskHash(`${payloadDigest}:${sourceId}`)}`
}

function withSource(trade: Trade, sourceId: string | undefined): Trade {
  return sourceId === trade.sourceTradeId ? trade : { ...trade, sourceTradeId: sourceId }
}

/** 先确定来源的归属，再比较依赖它的案例。最终输出沿用来件顺序。 */
export async function resolveImportedTrades(
  current: readonly Trade[], incoming: readonly Trade[], digest: string, verifyAsset?: VerifyImportAsset,
) {
  const localById = new Map(current.map(trade => [trade.id, trade]))
  const sourceById = new Map(incoming.map(trade => [trade.id, trade]))
  const resolved = new Map<string, Trade>()

  // 派生编号已有同源记录时沿用本地编辑；直接命中原编号则写入本批候选。
  function storedSource(originalId: string, row: Trade) {
    return row.id === originalId ? row : localById.get(row.id) ?? row
  }

  function effectiveSource(id: string | undefined) {
    if (!id) return undefined
    const row = resolved.get(id)
    return row ? storedSource(id, row) : localById.get(id)
  }

  async function projectCase(trade: Trade, source: Trade | undefined, originalSource: Trade | undefined) {
    const synced = syncReviewCaseSourceNote(trade, source)
    if (synced === trade) return trade
    const inputNote = originalSource?.note ?? trade.sourceNoteHtml ?? ''
    const outputNote = synced.sourceNoteHtml!
    const used = new Set(collectAssetIdsFromHtml([trade.note]))
    if (trade.decisionImageId) used.add(trade.decisionImageId)
    const remap = new Map<string, string>()
    if (verifyAsset && used.size && inputNote !== outputNote) {
      const pairs = correspondingAssets([inputNote], [outputNote])
      if (pairs && remapHtmlAssetIds(inputNote, id => pairs.get(id)!) === outputNote) {
        for (const [id, target] of pairs) {
          if (id !== target && used.has(id) && await verifyAsset(id, target)) remap.set(id, target)
        }
      }
    }
    const note = remap.size ? remapHtmlAssetIds(trade.note, id => remap.get(id) ?? id) : trade.note
    const selected = trade.decisionImageId
    if (!selected) return { ...synced, note }
    const target = remap.get(selected) ?? selected
    return { ...synced, note, decisionImageId: collectAssetIdsFromHtml([note, outputNote]).includes(target) ? target : null }
  }

  function assetVerifier(source: Trade | undefined) {
    if (!verifyAsset || !source || source.tradeKind === 'case' || source !== localById.get(source.id)) return verifyAsset
    // 本地来源正文带入的引用来自同一资料库。其他附件仍必须与暂存字节核对。
    const localIds = new Set(collectAssetIdsFromHtml([source.note]))
    const verify = verifyAsset
    return async (from: string, to: string) => (from === to && localIds.has(from)) || await verify(from, to)
  }

  async function place(trade: Trade, source: Trade | undefined): Promise<Trade> {
    const originalSource = trade.sourceTradeId ? sourceById.get(trade.sourceTradeId) : undefined
    const candidate = await projectCase(withSource(trade, source?.id ?? trade.sourceTradeId), source, originalSource)
    const local = localById.get(trade.id)
    if (!local) return candidate
    const match = await matchImportedTrade(local, candidate, candidate.tradeKind === 'case' ? assetVerifier(source) : verifyAsset)
    if (match === 'identical') {
      const refreshed = candidate.tradeKind === 'case' && source && source.tradeKind !== 'case' && candidate.sourceNoteHtml !== local.sourceNoteHtml
      return refreshed ? candidate : local
    }
    if (match === 'same-origin') return candidate
    return { ...candidate, id: stableImportedTradeId(digest, trade.id) }
  }

  // 历史快照允许互相引用。环末来源只有原编号和稳定副本两种可能，
  // 转一圈验证这个假设。若没有唯一归属，整组独立保留，避免改写本地来源。
  async function placeCycle(cycle: Trade[]) {
    const anchor = cycle[cycle.length - 1]!
    let unique: Trade[] | undefined
    for (const guess of [anchor.id, stableImportedTradeId(digest, anchor.id)]) {
      let source = storedSource(anchor.id, { ...anchor, id: guess })
      const trial: Trade[] = []
      for (const trade of cycle) {
        const candidate = await place(trade, source)
        trial.push(candidate)
        source = storedSource(trade.id, candidate)
      }
      if (source.id !== guess) continue
      if (trial.every((row, index) => row.id === cycle[index]!.id)) return trial
      if (unique) { unique = undefined; break }
      unique = trial
    }
    if (unique) return unique
    const ids = cycle.map(t => localById.has(t.id) ? stableImportedTradeId(digest, t.id) : t.id)
    const rows = cycle.map((t, index) => ({ ...t, id: ids[index]!, sourceTradeId: ids[(index + ids.length - 1) % ids.length]! }))
    return Promise.all(rows.map((row, index) => {
      const parent = (index + rows.length - 1) % rows.length
      return projectCase(row, storedSource(cycle[parent]!.id, rows[parent]!), cycle[parent])
    }))
  }

  for (const initial of incoming) {
    if (resolved.has(initial.id)) continue
    const chain: Trade[] = []
    const path = new Map<string, number>()
    let trade: Trade | undefined = initial
    while (trade && !resolved.has(trade.id)) {
      const cycleStart = path.get(trade.id)
      if (cycleStart !== undefined) {
        const cycle = chain.splice(cycleStart).reverse()
        const rows = await placeCycle(cycle)
        cycle.forEach((member, index) => resolved.set(member.id, rows[index]!))
        break
      }
      path.set(trade.id, chain.length)
      chain.push(trade)
      trade = trade.sourceTradeId === undefined ? undefined : sourceById.get(trade.sourceTradeId)
    }
    for (const member of chain.reverse()) {
      resolved.set(member.id, await place(member, effectiveSource(member.sourceTradeId)))
    }
  }

  const tradeIds = new Map<string, string>()
  const targets = new Set<string>()
  const merged = new Map(localById)
  const rewritten = incoming.map(trade => resolved.get(trade.id)!)
  for (const [index, row] of rewritten.entries()) {
    const source = incoming[index]!
    if (targets.has(row.id)) {
      throw new OperationalError('import-immutable-entity-conflict', `导入冲突：多笔交易映射到了同一 ID ${row.id}。`)
    }
    targets.add(row.id)
    tradeIds.set(source.id, row.id)
    const occupant = localById.get(row.id)
    if (!occupant || source.id === row.id) merged.set(row.id, row)
    else {
      const owner = effectiveSource(source.sourceTradeId)
      if (await matchImportedTrade(occupant, row, row.tradeKind === 'case' ? assetVerifier(owner) : verifyAsset) === 'different') {
        throw new Error(`导入冲突：稳定导入交易 ID ${row.id} 已被其他交易占用。`)
      }
    }
  }
  return { tradeIds, rewritten, trades: [...merged.values()] }
}

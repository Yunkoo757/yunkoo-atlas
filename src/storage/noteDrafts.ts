import { getStorage } from '@/storage/bootstrap'
import { assetUrl, normalizeNoteForStorage } from '@/storage/assets'
import { useStore } from '@/store/useStore'

/** TipTap 本地草稿：键入先落这里，idle / flush 再写入 trades 快照。 */
const drafts = new Map<string, string>()
const MAX_DRAFT_FLUSH_PASSES = 8
const activeTradeFlushes = new Map<string, Promise<boolean>>()

export function setNoteDraft(tradeId: string, html: string): void {
  drafts.set(tradeId, html)
}

export function clearNoteDraft(tradeId: string): void {
  drafts.delete(tradeId)
}

export function hasNoteDraft(tradeId: string): boolean {
  return drafts.has(tradeId)
}

export function getNoteDraft(tradeId: string): string | undefined {
  return drafts.get(tradeId)
}

/** 将全部草稿归一化后写入 store；写成功后清除。 */
export async function flushNoteDraftsToStore(): Promise<boolean> {
  for (let pass = 0; pass < MAX_DRAFT_FLUSH_PASSES; pass++) {
    if (drafts.size === 0) return true
    const results = await Promise.all(
      [...drafts.keys()].map((tradeId) => flushNoteDraftToStore(tradeId)),
    )
    if (results.some((complete) => !complete)) return false
  }
  return drafts.size === 0
}

async function flushSingleNoteDraft(tradeId: string): Promise<boolean> {
  for (let pass = 0; pass < MAX_DRAFT_FLUSH_PASSES; pass++) {
    const html = drafts.get(tradeId)
    if (html === undefined) return true
    try {
      const normalized = await normalizeNoteForStorage(html, getStorage())
      const current = useStore.getState().trades.find((t) => t.id === tradeId)
      if (current && normalized !== current.note) {
        useStore.getState().updateNote(tradeId, normalized)
      }
      // 归一化期间若继续输入，则继续冲洗新值；只有当前值稳定后才能报告成功。
      if (drafts.get(tradeId) === html) drafts.delete(tradeId)
    } catch {
      /* 保留草稿 */
      return false
    }
  }
  return !drafts.has(tradeId)
}

/** 同一交易的异步图片归一化必须串行，避免较慢的旧草稿反向覆盖新草稿。 */
export function flushNoteDraftToStore(tradeId: string): Promise<boolean> {
  const active = activeTradeFlushes.get(tradeId)
  if (active) return active
  const operation = flushSingleNoteDraft(tradeId).finally(() => {
    if (activeTradeFlushes.get(tradeId) === operation) {
      activeTradeFlushes.delete(tradeId)
    }
  })
  activeTradeFlushes.set(tradeId, operation)
  return operation
}

/** 慢图片保存完成时编辑器可能已卸载；将附件幂等合并到该交易的最新草稿。 */
export function appendAssetToNoteDraft(tradeId: string, assetId: string): Promise<boolean> {
  const src = assetUrl(assetId)
  const storedNote = useStore.getState().trades.find((trade) => trade.id === tradeId)?.note ?? ''
  const latest = drafts.get(tradeId) ?? storedNote
  if (!latest.includes(src)) {
    drafts.set(tradeId, `${latest}${latest ? '\n' : ''}<img src="${src}" />`)
  }
  return flushNoteDraftToStore(tradeId)
}

/** 测试用 */
export function resetNoteDraftsForTests(): void {
  drafts.clear()
}

export function noteDraftCountForTests(): number {
  return drafts.size
}

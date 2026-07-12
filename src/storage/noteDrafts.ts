import { getStorage } from '@/storage/bootstrap'
import { normalizeNoteForStorage } from '@/storage/assets'
import { useStore } from '@/store/useStore'

/** TipTap 本地草稿：键入先落这里，idle / flush 再写入 trades 快照。 */
const drafts = new Map<string, string>()

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
export async function flushNoteDraftsToStore(): Promise<void> {
  if (drafts.size === 0) return
  const entries = [...drafts.entries()]
  const storage = getStorage()
  for (const [tradeId, html] of entries) {
    try {
      const normalized = await normalizeNoteForStorage(html, storage)
      const current = useStore.getState().trades.find((t) => t.id === tradeId)
      if (current && normalized !== current.note) {
        useStore.getState().updateNote(tradeId, normalized)
      }
      drafts.delete(tradeId)
    } catch {
      /* 保留草稿，下次再试 */
    }
  }
}

export async function flushNoteDraftToStore(tradeId: string): Promise<void> {
  const html = drafts.get(tradeId)
  if (html === undefined) return
  try {
    const normalized = await normalizeNoteForStorage(html, getStorage())
    const current = useStore.getState().trades.find((t) => t.id === tradeId)
    if (current && normalized !== current.note) {
      useStore.getState().updateNote(tradeId, normalized)
    }
    drafts.delete(tradeId)
  } catch {
    /* 保留草稿 */
  }
}

/** 测试用 */
export function resetNoteDraftsForTests(): void {
  drafts.clear()
}

export function noteDraftCountForTests(): number {
  return drafts.size
}

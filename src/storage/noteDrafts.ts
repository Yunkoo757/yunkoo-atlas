import { getStorage } from '@/storage/provider'
import { syncReviewCaseSourceNotes } from '@/lib/reviewCaseSources'
import {
  assetUrl,
  normalizeNoteForStorage,
  normalizePreparedAssetReferencesForRecovery,
} from '@/storage/assets'
import { useStore } from '@/store/useStore'
import type { PersistedSnapshot } from '@/storage/types'

type NoteDomain = 'trade' | 'weeklyReview' | 'quickNote'
export type NoteDraftKey = `${NoteDomain}:${string}`

/** 草稿键只用于内存，冒号之后的记录 ID 原样保留。 */
export function noteDraftKey(domain: NoteDomain, id: string): NoteDraftKey {
  return `${domain}:${id}`
}

const drafts = new Map<NoteDraftKey, string>()
const MAX_DRAFT_FLUSH_PASSES = 8
const activeFlushes = new Map<NoteDraftKey, Promise<boolean>>()
let draftLifetime = new AbortController()

function storedNote(key: NoteDraftKey) {
  const separator = key.indexOf(':')
  const domain = key.slice(0, separator) as NoteDomain
  const id = key.slice(separator + 1)
  const state = useStore.getState()
  switch (domain) {
    case 'trade': {
      const trade = state.trades.find(trade => trade.id === id)
      return trade && { html: trade.note, update: (html: string) => state.updateNote(id, html) }
    }
    case 'weeklyReview': {
      const review = state.weeklyReviews.find(review => review.id === id)
      return review && { html: review.contentHtml, update: (contentHtml: string) => state.updateWeeklyReview(id, { contentHtml }) }
    }
    case 'quickNote': {
      const note = state.quickNotes.find(note => note.id === id)
      return note && { html: note.contentHtml, update: (contentHtml: string) => state.updateQuickNote(id, { contentHtml }) }
    }
  }
}

export function setNoteDraft(key: NoteDraftKey, html: string): void {
  drafts.set(key, html)
}

export function clearNoteDraft(key: NoteDraftKey): void {
  drafts.delete(key)
}

export function hasNoteDraft(key: NoteDraftKey): boolean {
  return drafts.has(key)
}

export function hasPendingNoteDrafts(): boolean {
  return drafts.size > 0
}

export function getNoteDraft(key: NoteDraftKey): string | undefined {
  return drafts.get(key)
}

/** 将全部草稿归一化后写入 store；写成功后清除。 */
export async function flushNoteDraftsToStore(): Promise<boolean> {
  for (let pass = 0; pass < MAX_DRAFT_FLUSH_PASSES; pass++) {
    if (drafts.size === 0) return true
    const results = await Promise.all(
      [...drafts.keys()].map((key) => flushNoteDraftToStore(key)),
    )
    if (results.some((complete) => !complete)) return false
  }
  return drafts.size === 0
}

async function flushSingleNoteDraft(key: NoteDraftKey): Promise<boolean> {
  const { signal } = draftLifetime
  for (let pass = 0; pass < MAX_DRAFT_FLUSH_PASSES; pass++) {
    const html = drafts.get(key)
    if (html === undefined) return true
    try {
      const normalized = await normalizeNoteForStorage(html, getStorage(), signal)
      if (signal.aborted) return true
      // 归一化让出执行权后，只发布仍属于本次扫描的正文。
      if (drafts.get(key) !== html) continue
      const target = storedNote(key)
      if (target && normalized !== target.html) target.update(normalized)
      // 归一化期间若继续输入，则继续冲洗新值；只有当前值稳定后才能报告成功。
      if (drafts.get(key) === html) drafts.delete(key)
    } catch {
      // 已撤销的草稿没有待保存内容；其他失败保留草稿供重试。
      return signal.aborted
    }
  }
  return !drafts.has(key)
}

/** 将尚未 preflush 的编辑器草稿覆盖进快照副本，仅用于冲突恢复导出。 */
export function applyNoteDraftsToSnapshot(snapshot: PersistedSnapshot): PersistedSnapshot {
  if (drafts.size === 0) return snapshot
  return {
    ...snapshot,
    trades: syncReviewCaseSourceNotes(snapshot.trades.map((trade) => {
      const note = drafts.get(noteDraftKey('trade', trade.id))
      return note === undefined
        ? trade
        : { ...trade, note: normalizePreparedAssetReferencesForRecovery(note) }
    })),
    weeklyReviews: snapshot.weeklyReviews?.map((review) => {
      const contentHtml = drafts.get(noteDraftKey('weeklyReview', review.id))
      return contentHtml === undefined
        ? review
        : { ...review, contentHtml: normalizePreparedAssetReferencesForRecovery(contentHtml) }
    }),
    quickNotes: snapshot.quickNotes?.map((note) => {
      const contentHtml = drafts.get(noteDraftKey('quickNote', note.id))
      return contentHtml === undefined
        ? note
        : { ...note, contentHtml: normalizePreparedAssetReferencesForRecovery(contentHtml) }
    }),
  }
}

/** 加载资料库最新版前使全部草稿及在途异步归一化失效，防止旧内容延迟写回。 */
export function discardAllNoteDrafts(): void {
  draftLifetime.abort()
  draftLifetime = new AbortController()
  activeFlushes.clear()
  drafts.clear()
}

/** 同一篇正文的异步图片归一化必须串行，避免较慢的旧草稿反向覆盖新草稿。 */
export function flushNoteDraftToStore(key: NoteDraftKey): Promise<boolean> {
  const active = activeFlushes.get(key)
  if (active) return active
  const operation = flushSingleNoteDraft(key).finally(() => {
    if (activeFlushes.get(key) === operation) {
      activeFlushes.delete(key)
    }
  })
  activeFlushes.set(key, operation)
  return operation
}

/** 慢图片保存完成时编辑器可能已卸载；将附件幂等合并到原记录的最新草稿。 */
export function appendAssetToNoteDraft(key: NoteDraftKey, assetId: string): Promise<boolean> {
  const src = assetUrl(assetId)
  const latest = drafts.get(key) ?? storedNote(key)?.html ?? ''
  if (!latest.includes(src)) {
    drafts.set(key, `${latest}${latest ? '\n' : ''}<img src="${src}" />`)
  }
  return flushNoteDraftToStore(key)
}

/** 测试用 */
export function resetNoteDraftsForTests(): void {
  discardAllNoteDrafts()
}

export function noteDraftCountForTests(): number {
  return drafts.size
}

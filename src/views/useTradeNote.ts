import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorChangeMeta } from '@/editor/Editor'
import { AssetObjectUrlScope } from '@/storage/assetObjectUrls'
import { resolveNoteForDisplayResult } from '@/storage/assets'
import { flushNoteDraftToStore, noteDraftKey, setNoteDraft } from '@/storage/noteDrafts'
import { getStorage } from '@/storage/provider'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'
import { loadDetailNote, removeMissingAssetReferences, type DetailNoteLoadResult } from './detailNoteLoad'

const loading = { status: 'loading' } as const
const NOTE_IDLE_COMMIT_MS = 2000

type LoadedNote = { tradeId: string; attempt: number; result: DetailNoteLoadResult }

/** 一次加载持有本记录的附件地址；离开时提交本库草稿，整库替换时由发布方撤销。 */
export function useTradeNote(tradeId: string | undefined, librarySession: number) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<LoadedNote | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // 重试期间保留失败正文及其只读编辑器。
    setLoaded(previous => previous && previous.tradeId === tradeId && previous.result.status === 'error' ? previous : null)
    const state = useStore.getState()
    const trade = state.trades.find(item => item.id === tradeId)
    if (!trade || state.librarySession !== librarySession) return
    const key = noteDraftKey('trade', trade.id)
    const images = new AssetObjectUrlScope()
    let active = true
    const ownsLoad = () => active && useStore.getState().librarySession === librarySession
    void loadDetailNote(trade.note, async html => {
      if (!ownsLoad()) return html
      return resolveNoteForDisplayResult(html, getStorage(), images)
    }, async () => {
      if (!(await flushNoteDraftToStore(key)) || !ownsLoad()) return false
      return useStore.getState().trades.find(item => item.id === trade.id)?.note ?? trade.note
    }).then(result => {
      if (ownsLoad()) setLoaded({ tradeId: trade.id, attempt, result })
    })
    return () => {
      active = false
      images.release()
      if (saveTimer.current !== null) clearTimeout(saveTimer.current)
      saveTimer.current = null
      if (useStore.getState().librarySession === librarySession) void flushNoteDraftToStore(key)
    }
  }, [tradeId, librarySession, attempt])

  const load = loaded && loaded.tradeId === tradeId ? loaded.result : loading
  const ready = load.status === 'ready'

  const change = useCallback((html: string, { origin }: EditorChangeMeta) => {
    if (!ready || !tradeId || useStore.getState().librarySession !== librarySession) return false
    setLoaded(previous => {
      if (!previous || previous.tradeId !== tradeId || previous.result.status !== 'ready') return previous
      return previous.result.html === html ? previous : { ...previous, result: { status: 'ready', html } }
    })
    if (origin === 'presentation') return false
    useSaveStatus.getState().setDirty()
    const key = noteDraftKey('trade', tradeId)
    setNoteDraft(key, html)
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      if (useStore.getState().librarySession === librarySession) void flushNoteDraftToStore(key)
    }, NOTE_IDLE_COMMIT_MS)
    return true
  }, [tradeId, ready, librarySession])

  const retry = () => setAttempt(value => value + 1)
  const removeMissingImages = () => {
    const state = useStore.getState()
    const trade = state.trades.find(item => item.id === tradeId)
    if (!trade || state.librarySession !== librarySession || load.status !== 'error' || load.reason !== 'incomplete') return 0
    const { html, removedCount } = removeMissingAssetReferences(trade.note, load.fallbackHtml)
    if (removedCount > 0) {
      state.updateNote(trade.id, html)
      retry()
    }
    return removedCount
  }

  return { load, change, retry, retrying: load.status === 'error' && loaded?.attempt !== attempt, removeMissingImages }
}

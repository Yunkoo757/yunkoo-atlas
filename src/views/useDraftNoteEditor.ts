import { useCallback, useEffect, useRef, useState } from 'react'
import { AssetObjectUrlScope } from '@/storage/assetObjectUrls'
import { resolveNoteForDisplayResult } from '@/storage/assets'
import { flushNoteDraftToStore, getNoteDraft, setNoteDraft, type NoteDraftKey } from '@/storage/noteDrafts'
import { getStorage } from '@/storage/provider'
import { useSaveStatus } from '@/store/saveStatus'
import { useStore } from '@/store/useStore'
import { loadDetailNote, type DetailNoteLoadResult } from './detailNoteLoad'

type Loaded = { key: NoteDraftKey; result: DetailNoteLoadResult; html: string }
type ReportFailure = (key: NoteDraftKey, retry: () => void) => void

/** 随记与周复盘按草稿原文打开；重试读取附件不会提交、清空或替换该草稿。 */
export function useDraftNoteEditor(
  key: NoteDraftKey | null,
  storedHtml: string,
  librarySession: number,
  reportFailure: ReportFailure,
) {
  const [entry, setEntry] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 同文档保存会更新 storedHtml；仅打开或主动重试时重载，保留输入与撤销栈。
  useEffect(() => {
    setEntry(null)
    if (!key || useStore.getState().librarySession !== librarySession) return
    const images = new AssetObjectUrlScope()
    let active = true
    // 从当前页面选中的记录起读；同 ID 的待归属周复盘不能替代当前阶段的空文档。
    const source = getNoteDraft(key) ?? storedHtml
    void loadDetailNote(source, html => resolveNoteForDisplayResult(html, getStorage(), images)).then(result => {
      if (active && useStore.getState().librarySession === librarySession) {
        setEntry({ key, result, html: result.status === 'ready' ? result.html : result.fallbackHtml })
      }
    })
    return () => {
      active = false
      images.release()
    }
  }, [key, librarySession, attempt])

  const flush = useCallback(async function save(): Promise<boolean> {
    if (useStore.getState().librarySession !== librarySession) return false
    if (!key) return true
    const ok = await flushNoteDraftToStore(key)
    if (useStore.getState().librarySession !== librarySession) return false
    if (!ok) reportFailure(key, () => { void save() })
    return ok
  }, [key, librarySession, reportFailure])

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    void flush()
  }, [flush])

  const current = entry?.key === key ? entry : null
  const load = current?.result
  const ready = load?.status === 'ready'
  const write = useCallback((html: string) => {
    if (!ready || !key || useStore.getState().librarySession !== librarySession) return false
    setEntry(previous => previous?.key === key ? { ...previous, html } : previous)
    useSaveStatus.getState().setDirty()
    setNoteDraft(key, html)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void flush()
    }, 500)
    return true
  }, [key, ready, flush, librarySession])

  return { load, html: current?.html ?? '', write, flush, retry: () => setAttempt(value => value + 1) }
}

import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Editor } from '@/editor/Editor'
import { NoteLoadRecovery } from '@/components/NoteLoadRecovery'
import {
  textFromQuickNoteHtml,
  titleFromQuickNoteHtml,
} from '@/data/quickNotes'
import { isComposingKey } from '@/lib/keyboardComposition'
import { createAndOpenQuickNote } from '@/lib/createRecordAction'
import { currentLiveStageIdForWrite, useStore } from '@/store/useStore'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { buildQuickNoteRecord, getNextTradeRef } from '@/lib/quickNoteRecordDraft'
import { acquireQuickNoteConversion, isQuickNoteConverting, isQuickNoteViewOpen, registerQuickNoteConversionView, subscribeQuickNoteConversions } from '@/lib/quickNoteConversion'
import { trackPendingStorageOperation } from '@/storage/pendingOperations'
import {
  noteDraftKey, type NoteDraftKey,
  clearNoteDraft,
  getNoteDraft,
} from '@/storage/noteDrafts'
import { Pin, Plus, Trash2 } from '@/icons/appIcons'
import { PinActionIcon } from '@/icons/StateIcons'
import { EmptyState } from '@/components/EmptyState'
import { DisclosureSummary } from '@/components/ui/DisclosureSummary'
import { SearchField } from '@/components/ui/SearchField'
import { Toolbar } from '@/components/ui/Toolbar'
import { ModalShell } from '@/components/ui/ModalShell'
import { InlineStatus } from '@/components/ui/InlineStatus'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { useSaveStatus } from '@/store/saveStatus'
import { toast } from '@/lib/toast'
import { useDraftNoteEditor } from './useDraftNoteEditor'
import { withLibrarySession } from './withLibrarySession'
import './QuickNotesView.css'

const QUICK_NOTE_HISTORY_LIMIT = 50

function formatNoteTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

function reportDraftFailure(key: NoteDraftKey, retry: () => void) {
  useSaveStatus.getState().setError('随记正文仍保留在本次会话草稿中，尚未写入资料库')
  toast('随记保存失败，正文仍保留；请重试', {
    tone: 'error', actionLabel: '重试', onAction: retry, dedupeKey: `quick-note-save:${key}`,
  })
}

export const QuickNotesView = withLibrarySession<object>(QuickNotesWorkspace)

function QuickNotesWorkspace({ librarySession }: { librarySession: number }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const notes = useStore((state) => state.quickNotes)
  const updateNote = useStore((state) => state.updateQuickNote)
  const removeNote = useStore((state) => state.removeQuickNote)
  const upsertTrade = useStore((state) => state.upsertTrade)
  const query = new URLSearchParams(location.search).get('q') ?? ''
  const setQuery = (value: string) => {
    navigationIntent.current++
    const next = new URLSearchParams(location.search)
    if (value) next.set('q', value)
    else next.delete('q')
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true, state: location.state })
  }
  const [editingTitle, setEditingTitle] = useState<{ id: string; value: string } | null>(null)
  const editorPane = useRef<HTMLElement>(null)
  const navigationIntent = useRef(0)
  const skipFocus = useRef(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const noteHistoriesRef = useRef(new Map<string, string[]>())

  const filteredNotes = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return notes
    return notes.filter((note) => (
      `${note.title} ${textFromQuickNoteHtml(note.contentHtml)}`
        .toLocaleLowerCase('zh-CN')
        .includes(keyword)
    ))
  }, [notes, query])
  const selectedNote = notes.find((note) => note.id === id) ?? null
  const key = selectedNote ? noteDraftKey('quickNote', selectedNote.id) : null
  const { load, html: editorHtml, write, flush: flushDraft, retry } = useDraftNoteEditor(key, selectedNote?.contentHtml ?? '', librarySession, reportDraftFailure)
  const editorReady = load?.status === 'ready'
  const editSessionRef = useRef<{ load: typeof load; baseline: string | null } | null>(null)
  const converting = useSyncExternalStore(
    subscribeQuickNoteConversions,
    () => selectedNote ? isQuickNoteConverting(selectedNote.id) : false,
  )

  useLayoutEffect(() => selectedNote
    ? registerQuickNoteConversionView(selectedNote.id)
    : undefined, [selectedNote?.id])

  useLayoutEffect(() => () => { navigationIntent.current++ }, [id])

  const createNote = useCallback(async () => {
    const intent = ++navigationIntent.current
    if (selectedNote) {
      if (!await flushDraft()) return
    }
    if (intent === navigationIntent.current) createAndOpenQuickNote(navigate, location.pathname)
  }, [flushDraft, location.pathname, navigate, selectedNote])

  const openNote = useCallback(async (noteId: string, focusFrom?: HTMLElement) => {
    const intent = ++navigationIntent.current
    const sameNote = selectedNote?.id === noteId
    if (sameNote && !focusFrom) return
    if (selectedNote && !sameNote) {
      if (!await flushDraft()) return
    }
    if (intent !== navigationIntent.current || (focusFrom && document.activeElement !== focusFrom)) return
    navigate({ pathname: `/notes/${encodeURIComponent(noteId)}`, search: location.search }, {
      replace: sameNote,
      state: focusFrom ? { focusNoteEditor: noteId } : null,
    })
  }, [flushDraft, location.search, navigate, selectedNote])

  function handleListKeys(event: ReactKeyboardEvent<HTMLElement>) {
    if (isComposingKey(event.nativeEvent) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
    const pane = event.currentTarget
    const search = pane.querySelector<HTMLInputElement>('input[type="search"]')
    const rows = Array.from(pane.querySelectorAll<HTMLButtonElement>('.quick-notes-list-item'))
    const index = rows.indexOf(event.target as HTMLButtonElement)
    if (!rows.length || (index < 0 && event.target !== search)) return
    if (index < 0 && event.key === 'ArrowUp') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter') {
      if (event.repeat) return
      const row = rows[Math.max(index, 0)]
      row.focus()
      void openNote(filteredNotes[Math.max(index, 0)].id, row)
    } else if (event.key === 'ArrowUp' && index === 0) {
      search?.focus()
    } else {
      rows[Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))].focus()
    }
  }

  // 只选进入列表时已有的随记，等路由完成订阅再跳转。
  useLayoutEffect(() => {
    if (id) return
    const first = filteredNotes[0]
    if (!first) return
    const intent = navigationIntent.current
    queueMicrotask(() => {
      if (intent === navigationIntent.current) navigate({ pathname: `/notes/${encodeURIComponent(first.id)}`, search: location.search }, { replace: true })
    })
  }, [filteredNotes, id, location.search, navigate])

  const editorFocusRequested = Boolean(id && (location.state?.focusNewNote === id || location.state?.focusNoteEditor === id))
  useLayoutEffect(() => {
    if (!editorFocusRequested) return
    skipFocus.current = false
    const userMoved = () => { skipFocus.current = true }
    document.addEventListener('pointerdown', userMoved, true)
    document.addEventListener('keydown', userMoved, true)
    document.addEventListener('focusin', userMoved, true)
    return () => {
      document.removeEventListener('pointerdown', userMoved, true)
      document.removeEventListener('keydown', userMoved, true)
      document.removeEventListener('focusin', userMoved, true)
    }
  }, [editorFocusRequested, location.key])

  useLayoutEffect(() => {
    if (!editorFocusRequested || !load) return
    const pane = editorPane.current
    if (!pane) return
    const focusWhenReady = () => {
      const body = pane.querySelector<HTMLElement>('[contenteditable="true"]')
      if (!body && !skipFocus.current && editorReady) return
      observer.disconnect()
      if (body && !skipFocus.current && !document.activeElement?.matches('input, textarea, [contenteditable="true"]')) {
        body.focus()
      }
      const { focusNewNote: _newNote, focusNoteEditor: _keyboard, ...rest } = location.state
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: rest })
    }
    const observer = new MutationObserver(focusWhenReady)
    observer.observe(pane, { childList: true, subtree: true })
    focusWhenReady()
    return () => observer.disconnect()
  }, [editorFocusRequested, editorReady, id, load, location.pathname, location.search, location.state, navigate])

  const onEditorChange = useCallback((html: string) => {
    if (!selectedNote || load?.status !== 'ready' || !write(html)) return
    const session = editSessionRef.current
    const baseline = session?.load === load ? session.baseline : load.html
    if (baseline === null || baseline === html) return
    const history = noteHistoriesRef.current.get(selectedNote.id) ?? []
    if (history.at(-1) !== baseline) history.push(baseline)
    if (history.length > QUICK_NOTE_HISTORY_LIMIT) history.shift()
    noteHistoriesRef.current.set(selectedNote.id, history)
    editSessionRef.current = { load, baseline: null }
  }, [selectedNote, load, write])

  const onEditorHistoryFallback = useCallback((currentHtml: string): string | null => {
    if (!selectedNote || load?.status !== 'ready') return null
    const history = noteHistoriesRef.current.get(selectedNote.id)
    if (!history) return null
    while (history.at(-1) === currentHtml) history.pop()
    const restored = history.pop()
    if (restored === undefined || !write(restored)) return null
    editSessionRef.current = { load, baseline: restored }
    return restored
  }, [selectedNote, load, write])

  const confirmDelete = () => {
    if (!deleteTarget) return
    const target = notes.find((note) => note.id === deleteTarget.id)
    if (!target) {
      setDeleteTarget(null)
      toast('这条随记已不存在，未执行删除')
      return
    }
    const currentIndex = filteredNotes.findIndex((note) => note.id === target.id)
    const next = filteredNotes[currentIndex + 1] ?? filteredNotes[currentIndex - 1]
    clearNoteDraft(noteDraftKey('quickNote', target.id))
    noteHistoriesRef.current.delete(target.id)
    removeNote(target.id)
    setDeleteTarget(null)
    if (selectedNote?.id === target.id) {
      navigate({ pathname: next ? `/notes/${encodeURIComponent(next.id)}` : '/notes', search: location.search }, { replace: true })
    }
    toast('随记已删除')
  }

  const convertNote = (kind: 'live' | 'case') => {
    if (!selectedNote) return
    const releaseConversion = acquireQuickNoteConversion(selectedNote.id)
    if (!releaseConversion) return
    const operation = (async () => {
      let succeeded = false
      try {
        if (!await flushDraft()) return
        const store = useStore.getState()
        if (store.librarySession !== librarySession) return
        const latest = store.quickNotes.find((note) => note.id === selectedNote.id)
        if (!latest) return
        const created = buildQuickNoteRecord({
          note: latest,
          kind,
          id: crypto.randomUUID(),
          ref: getNextTradeRef(store.trades, kind),
          strategyId: store.strategies[0]?.id ?? '',
          symbol: store.symbolCatalog[0] ?? latest.title,
          liveStageId: currentLiveStageIdForWrite(store),
          tradingDayStartHour: store.display.tradingDayStartHour,
        })
        if (upsertTrade(created) !== 'updated') throw new Error(kind === 'case' ? '案例未写入' : '交易未写入')
        succeeded = true
        const openCreated = () => navigate(tradeDetailPath(created), {
          state: tradeDetailNavState({ pathname: `/notes/${encodeURIComponent(latest.id)}`, search: location.search }),
        })
        const message = kind === 'case' ? '已写入案例草稿' : '已写入交易草稿'
        if (isQuickNoteViewOpen(latest.id)) {
          toast(message)
          openCreated()
        } else {
          toast(message, { actionLabel: '打开草稿', onAction: openCreated })
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : '未能写入记录', { tone: 'error' })
      } finally {
        releaseConversion(succeeded)
      }
    })()
    return trackPendingStorageOperation(operation)
  }

  return (
    <section className="quick-notes-page">
      <Toolbar
        title="随记"
        actions={notes.length > 0 ? (
          <>
            <SaveStatusIndicator />
            <Button type="button" variant="primary" onClick={() => void createNote()}>
              <Plus size={ICON_MD} />
              新建随记
            </Button>
          </>
        ) : undefined}
      />

      <div className={`quick-notes-workspace${notes.length === 0 ? ' is-empty' : ''}`}>
        {notes.length > 0 ? <aside className="quick-notes-list-pane" aria-label="随记列表" onKeyDown={handleListKeys}>
          <SearchField label="搜索随记" value={query} onChange={setQuery} size="sm" className="quick-notes-search" />
          <div className="quick-notes-list">
            {filteredNotes.map((note) => {
              const summary = textFromQuickNoteHtml(note.contentHtml)
              return (
                <button
                  key={note.id}
                  type="button"
                  className={`quick-notes-list-item${note.id === selectedNote?.id ? ' is-active' : ''}`}
                  aria-current={note.id === selectedNote?.id ? 'true' : undefined}
                  onClick={() => void openNote(note.id)}
                >
                  <span className="quick-notes-list-title">
                    {note.pinned ? <Pin size={ICON_SM} aria-label="已置顶" /> : null}
                    <strong>{note.title}</strong>
                    <time>{formatNoteTime(note.updatedAt)}</time>
                  </span>
                  <span className="quick-notes-list-summary">{summary || '开始记录一个想法…'}</span>
                </button>
              )
            })}
            {filteredNotes.length === 0 && notes.length > 0 ? (
              <p className="quick-notes-list-empty" role="status">没有匹配的随记</p>
            ) : null}
          </div>
        </aside> : null}

        <section ref={editorPane} className="quick-notes-editor-pane" aria-label="随记编辑区">
          {selectedNote ? (
            <>
              <header className="quick-notes-editor-header">
                <input
                  type="text"
                  value={editingTitle?.id === selectedNote.id ? editingTitle.value : selectedNote.title}
                  maxLength={80}
                  aria-label="随记标题"
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || isComposingKey(event.nativeEvent) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
                    const body = editorPane.current?.querySelector<HTMLElement>('[contenteditable="true"]')
                    if (body) {
                      event.preventDefault()
                      body.focus()
                    }
                  }}
                  onBlur={() => setEditingTitle(null)}
                  onChange={(event) => {
                    const title = event.target.value.slice(0, 80)
                    setEditingTitle({ id: selectedNote.id, value: title })
                    updateNote(selectedNote.id, title.trim()
                      ? { title, titleMode: 'manual' }
                      : {
                          title: titleFromQuickNoteHtml(getNoteDraft(noteDraftKey('quickNote', selectedNote.id)) ?? selectedNote.contentHtml),
                          titleMode: 'auto',
                        })
                  }}
                />
                <div className="quick-notes-editor-actions">
                  <IconButton label={selectedNote.pinned ? '取消置顶' : '置顶随记'} tooltip={selectedNote.pinned ? '取消置顶' : '置顶随记'}
                    pressed={selectedNote.pinned} onClick={() => updateNote(selectedNote.id, { pinned: !selectedNote.pinned })}>
                    <PinActionIcon key={selectedNote.id} pinned={selectedNote.pinned} size={ICON_MD} />
                  </IconButton>
                  <IconButton label="删除随记" tooltip="删除随记" className="is-danger"
                    onClick={() => setDeleteTarget({ id: selectedNote.id, title: selectedNote.title })}>
                    <Trash2 size={ICON_MD} />
                  </IconButton>
                </div>
              </header>
              <div className="quick-notes-editor-meta">
                <span>
                  更新于 {new Intl.DateTimeFormat('zh-CN', {
                    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  }).format(new Date(selectedNote.updatedAt))}
                </span>
                <details className="quick-notes-actions-disclosure">
                  <DisclosureSummary>随记操作</DisclosureSummary>
                  <div className="quick-notes-editor-organize">
                    <Button
                      size="sm"
                      variant="ghost"
                      data-note-convert-live
                      disabled={converting || !load}
                      onClick={() => void convertNote('live')}
                    >
                      转为交易
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-note-convert-case
                      disabled={converting || !load}
                      onClick={() => void convertNote('case')}
                    >
                      转为案例
                    </Button>
                  </div>
                </details>
              </div>
              <div className="quick-notes-editor-body">
                {!load ? (
                  <InlineStatus tone="progress" title="正在载入随记" />
                ) : null}
                {load?.status === 'error' && (
                  <NoteLoadRecovery missingImages={load.reason === 'incomplete'} onRetry={retry} />
                )}
                {load ? (
                  <Editor
                    key={selectedNote.id}
                    content={editorHtml}
                    onChange={onEditorChange}
                    noteDraftId={noteDraftKey('quickNote', selectedNote.id)}
                    onHistoryFallback={onEditorHistoryFallback}
                    readOnly={!editorReady}
                    ariaLabel="随记正文"
                    placeholder="记录此刻的想法、盘面观察或灵感… 可直接粘贴截图"
                  />
                ) : null}
              </div>
            </>
          ) : id ? (
            <EmptyState variant="missing" title="找不到这条随记" action={
              <Button variant="bordered" onClick={() => navigate({ pathname: '/notes', search: location.search }, { replace: true })}>返回随记列表</Button>
            } />
          ) : notes.length > 0 ? null : (
            <EmptyState
              className="quick-notes-empty"
              title="留下一条随记"
              hint="记录想法或保存截图。"
              action={(
                <Button type="button" variant="primary" onClick={() => void createNote()}>
                  <Plus size={ICON_MD} />
                  新建随记
                </Button>
              )}
            />
          )}
        </section>
      </div>

      {deleteTarget ? (
        <ModalShell
          title="删除这条随记？"
          description={`将永久删除“${deleteTarget.title}”及其中的截图。`}
          size="compact"
          onClose={() => setDeleteTarget(null)}
          footer={(
            <>
              <Button type="button" size="lg" variant="bordered" data-autofocus onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button type="button" size="lg" variant="danger-solid" onClick={confirmDelete}>删除随记</Button>
            </>
          )}
        />
      ) : null}
    </section>
  )
}

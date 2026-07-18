import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Editor } from '@/editor/Editor'
import {
  createQuickNote,
  textFromQuickNoteHtml,
  titleFromQuickNoteHtml,
  UNTITLED_QUICK_NOTE,
} from '@/data/quickNotes'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage/bootstrap'
import { resolveNoteForDisplayResult } from '@/storage/assets'
import {
  clearNoteDraft,
  flushNoteDraftToStore,
  QUICK_NOTE_DRAFT_PREFIX,
  setNoteDraft,
} from '@/storage/noteDrafts'
import { FileText, Pin, PinOff, Plus, Search, Trash2 } from '@/icons/appIcons'
import { ModalShell } from '@/components/ui/ModalShell'
import { toast } from '@/lib/toast'
import './QuickNotesView.css'

const NOTE_IDLE_COMMIT_MS = 500

function formatNoteTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

export function QuickNotesView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const notes = useStore((state) => state.quickNotes)
  const upsertNote = useStore((state) => state.upsertQuickNote)
  const updateNote = useStore((state) => state.updateQuickNote)
  const removeNote = useStore((state) => state.removeQuickNote)
  const [query, setQuery] = useState('')
  const [editorHtml, setEditorHtml] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const createNote = useCallback(() => {
    const note = createQuickNote()
    upsertNote(note)
    navigate(`/notes/${encodeURIComponent(note.id)}`)
  }, [navigate, upsertNote])

  useEffect(() => {
    if (selectedNote || notes.length === 0) return
    navigate(`/notes/${encodeURIComponent(notes[0]!.id)}`, { replace: true })
  }, [navigate, notes, selectedNote])

  useEffect(() => {
    setEditorReady(false)
    setEditorHtml('')
    if (!selectedNote) return
    const draftId = `${QUICK_NOTE_DRAFT_PREFIX}${selectedNote.id}`
    let cancelled = false
    void resolveNoteForDisplayResult(selectedNote.contentHtml, getStorage()).then((result) => {
      if (cancelled) return
      setEditorHtml(result.html)
      setEditorReady(result.editable)
      if (!result.editable) toast('随记中有图片附件缺失，正文已切换为只读')
    })
    return () => {
      cancelled = true
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
      noteTimerRef.current = null
      void flushNoteDraftToStore(draftId)
    }
  }, [selectedNote?.id])

  const onEditorChange = useCallback((html: string) => {
    if (!selectedNote || !editorReady) return
    setEditorHtml(html)
    const draftId = `${QUICK_NOTE_DRAFT_PREFIX}${selectedNote.id}`
    setNoteDraft(draftId, html)
    if (selectedNote.title === UNTITLED_QUICK_NOTE) {
      const derivedTitle = titleFromQuickNoteHtml(html)
      if (derivedTitle !== UNTITLED_QUICK_NOTE) updateNote(selectedNote.id, { title: derivedTitle })
    }
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => {
      noteTimerRef.current = null
      void flushNoteDraftToStore(draftId)
    }, NOTE_IDLE_COMMIT_MS)
  }, [editorReady, selectedNote, updateNote])

  const confirmDelete = () => {
    if (!selectedNote) return
    const currentIndex = notes.findIndex((note) => note.id === selectedNote.id)
    const next = notes[currentIndex + 1] ?? notes[currentIndex - 1] ?? null
    clearNoteDraft(`${QUICK_NOTE_DRAFT_PREFIX}${selectedNote.id}`)
    removeNote(selectedNote.id)
    setDeleteOpen(false)
    navigate(next ? `/notes/${encodeURIComponent(next.id)}` : '/notes', { replace: true })
    toast('随记已删除')
  }

  return (
    <section className="quick-notes-page">
      <header className="quick-notes-topbar">
        <div>
          <h1>随记</h1>
          <p>记录想法、观察与截图，不参与交易统计</p>
        </div>
        <button type="button" className="quick-notes-new" onClick={createNote}>
          <Plus size={16} />
          新建随记
        </button>
      </header>

      <div className="quick-notes-workspace">
        <aside className="quick-notes-list-pane" aria-label="随记列表">
          <label className="quick-notes-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索随记"
              aria-label="搜索随记"
            />
          </label>
          <div className="quick-notes-list">
            {filteredNotes.map((note) => {
              const summary = textFromQuickNoteHtml(note.contentHtml)
              return (
                <button
                  key={note.id}
                  type="button"
                  className={`quick-notes-list-item${note.id === selectedNote?.id ? ' is-active' : ''}`}
                  onClick={() => navigate(`/notes/${encodeURIComponent(note.id)}`)}
                >
                  <span className="quick-notes-list-title">
                    {note.pinned ? <Pin size={13} aria-label="已置顶" /> : null}
                    <strong>{note.title}</strong>
                    <time>{formatNoteTime(note.updatedAt)}</time>
                  </span>
                  <span className="quick-notes-list-summary">{summary || '开始记录一个想法…'}</span>
                </button>
              )
            })}
            {filteredNotes.length === 0 && notes.length > 0 ? (
              <div className="quick-notes-list-empty">没有匹配的随记</div>
            ) : null}
          </div>
        </aside>

        <main className="quick-notes-editor-pane">
          {selectedNote ? (
            <>
              <header className="quick-notes-editor-header">
                <input
                  type="text"
                  value={selectedNote.title}
                  maxLength={80}
                  aria-label="随记标题"
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => updateNote(selectedNote.id, {
                    title: event.target.value.slice(0, 80),
                  })}
                  onBlur={(event) => {
                    if (!event.currentTarget.value.trim()) {
                      updateNote(selectedNote.id, { title: titleFromQuickNoteHtml(editorHtml) })
                    }
                  }}
                />
                <div className="quick-notes-editor-actions">
                  <button
                    type="button"
                    aria-label={selectedNote.pinned ? '取消置顶' : '置顶随记'}
                    title={selectedNote.pinned ? '取消置顶' : '置顶随记'}
                    onClick={() => updateNote(selectedNote.id, { pinned: !selectedNote.pinned })}
                  >
                    {selectedNote.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    aria-label="删除随记"
                    title="删除随记"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </header>
              <div className="quick-notes-editor-meta">
                更新于 {new Intl.DateTimeFormat('zh-CN', {
                  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
                }).format(new Date(selectedNote.updatedAt))}
              </div>
              <div className="quick-notes-editor-body">
                <Editor
                  key={selectedNote.id}
                  content={editorHtml}
                  onChange={onEditorChange}
                  noteDraftId={`${QUICK_NOTE_DRAFT_PREFIX}${selectedNote.id}`}
                  readOnly={!editorReady}
                  ariaLabel="随记正文"
                  placeholder="记录此刻的想法、盘面观察或灵感… 可直接粘贴截图"
                />
              </div>
            </>
          ) : (
            <div className="quick-notes-empty">
              <span><FileText size={24} /></span>
              <h2>留下一条随记</h2>
              <p>不用先决定它属于哪笔交易，先把想法和证据保存下来。</p>
              <button type="button" onClick={createNote}><Plus size={16} />新建随记</button>
            </div>
          )}
        </main>
      </div>

      {deleteOpen && selectedNote ? (
        <ModalShell
          title="删除这条随记？"
          description="删除后无法恢复，其中的截图会在后续存储清理时一并移除。"
          size="compact"
          onClose={() => setDeleteOpen(false)}
          footer={(
            <>
              <button type="button" onClick={() => setDeleteOpen(false)}>取消</button>
              <button type="button" className="is-danger" data-autofocus onClick={confirmDelete}>删除随记</button>
            </>
          )}
        />
      ) : null}
    </section>
  )
}

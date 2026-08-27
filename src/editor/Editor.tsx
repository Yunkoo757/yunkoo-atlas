import { useEditor, EditorContent, BubbleMenu, type Editor as TiptapEditor } from '@tiptap/react'
import type { Content } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getStorage } from '@/storage/bootstrap'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading2,
  List,
  ListChecks,
  FileText,
  Quote,
} from '@/icons/appIcons'
import { ICON_SM, ICON_TOOLBAR } from '@/icons/iconSize'
import { useShortcutStore } from '@/store/shortcutStore'
import { collectImageSrcsFromHtml, indexOfImageSrc } from '@/shortcuts/images'
import { ImageLoadFailure, setEditorImageLoadFailed } from './imageLoadFailure'
import { trackPendingStorageOperation } from '@/storage/pendingOperations'
import { appendAssetToNoteDraft } from '@/storage/noteDrafts'
import { MAX_WEB_JOURNAL_ENTRY_BYTES } from '@/lib/webJournalArchiveContract'
import { toast } from '@/lib/toast'
import type { ReviewTemplate } from '@/data/reviewTemplates'
import { Menu } from '@/components/Menu'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  ReviewContext,
  hasLeadingReviewParagraphs,
  hasReviewContextDocument,
  toggleReviewContextDocument,
} from './reviewContext'
import './Editor.css'

function setContentWithoutHistory(editor: TiptapEditor, content: Content): void {
  editor
    .chain()
    .setContent(content, false)
    .command(({ tr }) => {
      tr.setMeta('addToHistory', false)
      return true
    })
    .run()
}

export function syncEditorLightboxEditable(
  editor: Pick<TiptapEditor, 'setEditable'>,
  lightboxOpen: boolean,
  readOnly = false,
): void {
  editor.setEditable(!lightboxOpen && !readOnly, false)
}

export type EditorChangeMeta = Readonly<{
  origin: 'user' | 'presentation'
}>

export function Editor({
  content,
  onChange,
  placeholder = '写下这笔交易的复盘思路… 输入 “- ” 开始清单，“> ” 引用，可直接粘贴/拖入截图',
  readOnly = false,
  noteDraftId,
  allowImages = true,
  ariaLabel,
  reviewContextTools = false,
  reviewTemplates = [],
  reviewContextPinned = true,
  onHistoryFallback,
}: {
  content: string
  onChange: (html: string, meta: EditorChangeMeta) => void
  placeholder?: string
  readOnly?: boolean
  noteDraftId?: string
  allowImages?: boolean
  ariaLabel?: string
  /** 交易详情：将开头盘面叙述固定在截图上方，并提供通用起稿骨架。 */
  reviewContextTools?: boolean
  reviewTemplates?: ReviewTemplate[]
  reviewContextPinned?: boolean
  onHistoryFallback?: (currentHtml: string) => string | null
}) {
  const lightboxOpen = useShortcutStore((s) => s.lightbox !== null)
  const onChangeRef = useRef(onChange)
  const readOnlyRef = useRef(readOnly)
  const editorRef = useRef<TiptapEditor | null>(null)
  const noteDraftIdRef = useRef(noteDraftId)
  const allowImagesRef = useRef(allowImages)
  const onHistoryFallbackRef = useRef(onHistoryFallback)
  const [hasReviewContext, setHasReviewContext] = useState(false)
  const [hasLeadingReviewText, setHasLeadingReviewText] = useState(false)
  onChangeRef.current = onChange
  readOnlyRef.current = readOnly
  noteDraftIdRef.current = noteDraftId
  allowImagesRef.current = allowImages
  onHistoryFallbackRef.current = onHistoryFallback
  const openLightboxForEditor = (src: string, ownerId?: string, source?: HTMLElement) => {
    const currentEditor = editorRef.current
    currentEditor?.commands.blur()
    const html = currentEditor?.getHTML() ?? ''
    const images = collectImageSrcsFromHtml(html)
    const list = images.length > 0 ? images : [src]
    const rect = source?.getBoundingClientRect()
    const origin = source && rect && rect.width > 0 && rect.height > 0
      ? {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          borderRadius: Number.parseFloat(getComputedStyle(source).borderRadius) || 0,
        }
      : undefined
    useShortcutStore.getState().openLightbox(list, indexOfImageSrc(list, src), ownerId, origin)
  }
  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      ReviewContext,
      Image.configure({ inline: false, allowBase64: false }).extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            'data-asset-id': { default: null },
          }
        },
      }),
      ImageLoadFailure,
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    editorProps: {
      attributes: {
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      handleKeyDown(_view, event) {
        const currentEditor = editorRef.current
        const fallback = onHistoryFallbackRef.current
        const mod = event.ctrlKey || event.metaKey
        const key = event.key.toLowerCase()
        if (!currentEditor || !fallback || !mod || event.altKey) return false
        if (key !== 'z' || event.shiftKey || currentEditor.can().undo()) return false
        const restored = fallback(currentEditor.getHTML())
        if (restored === null) return false
        setContentWithoutHistory(currentEditor, restored)
        return true
      },
      handlePaste(_view, event) {
        if (!allowImagesRef.current) return false
        const items = event.clipboardData?.items
        if (!items) return false
        for (const it of Array.from(items)) {
          if (it.type.startsWith('image/')) {
            const file = it.getAsFile()
            if (file && editorRef.current) {
              void trackPendingStorageOperation(
                insertImageFile(editorRef.current, file, noteDraftIdRef.current),
              )
              return true
            }
          }
        }
        return false
      },
      handleDrop(_view, event) {
        if (!allowImagesRef.current) return false
        const files = (event as DragEvent).dataTransfer?.files
        if (files && files.length && files[0].type.startsWith('image/')) {
          if (editorRef.current) {
            void trackPendingStorageOperation(
              insertImageFile(editorRef.current, files[0], noteDraftIdRef.current),
            )
            event.preventDefault()
            return true
          }
        }
        return false
      },
      handleDOMEvents: {
        dblclick(_view, event) {
          const target = event.target as HTMLElement
          if (target.tagName !== 'IMG') return false
          const src = target.getAttribute('src')
          if (!src) return false
          event.preventDefault()
          openLightboxForEditor(src, noteDraftIdRef.current, target)
          return true
        },
        click(view, event) {
          const target = event.target as HTMLElement
          if (!target.classList.contains('ProseMirror')) return false
          const coords = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })
          if (coords) return false
          editorRef.current?.chain().focus('end').run()
          return true
        },
      },
    },
    onUpdate: ({ editor }) => {
      const doc = editor.getJSON()
      setHasReviewContext(hasReviewContextDocument(doc))
      setHasLeadingReviewText(hasLeadingReviewParagraphs(doc))
      if (!readOnlyRef.current) {
        onChangeRef.current(editor.getHTML(), { origin: 'user' })
      }
    },
    onCreate: ({ editor }) => {
      const doc = editor.getJSON()
      setHasReviewContext(hasReviewContextDocument(doc))
      setHasLeadingReviewText(hasLeadingReviewParagraphs(doc))
    },
  })

  editorRef.current = editor

  useEffect(() => {
    if (!editor) return
    syncEditorLightboxEditable(editor, lightboxOpen, readOnly)
  }, [editor, lightboxOpen, readOnly])

  useLayoutEffect(() => {
    if (!editor) return
    if (content !== editor.getHTML()) setContentWithoutHistory(editor, content)
    const doc = editor.getJSON()
    setHasReviewContext(hasReviewContextDocument(doc))
    setHasLeadingReviewText(hasLeadingReviewParagraphs(doc))
  }, [content, editor])

  useEffect(() => {
    if (!editor || readOnly || !reviewContextTools) return
    const doc = editor.getJSON()
    const contextActive = hasReviewContextDocument(doc)
    const leadingText = hasLeadingReviewParagraphs(doc)
    if ((reviewContextPinned && !contextActive && leadingText) || (!reviewContextPinned && contextActive)) {
      const next = toggleReviewContextDocument(doc)
      setHasReviewContext(hasReviewContextDocument(next))
      setHasLeadingReviewText(hasLeadingReviewParagraphs(next))
      const frame = requestAnimationFrame(() => {
        setContentWithoutHistory(editor, next)
        onChangeRef.current(editor.getHTML(), { origin: 'presentation' })
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [editor, readOnly, reviewContextPinned, reviewContextTools])

  const reviewContextActive = hasReviewContext
  const leadingReviewText = hasLeadingReviewText

  const insertReviewTemplate = (templateContent: string) => {
    if (!editor || readOnly) return
    let next = toggleReviewContextDocument(editor.getJSON(), templateContent)
    if (!reviewContextPinned) next = toggleReviewContextDocument(next)
    editor.commands.setContent(next, true)
    editor.commands.focus('end')
  }

  const showReviewStarter = reviewContextTools && !reviewContextActive && !leadingReviewText

  const reviewButton = (
    <Tooltip
      content="从自定义模板开始本次复盘"
      label="选择复盘起稿"
      asChild
    >
      <button
        type="button"
        aria-label="选择复盘起稿"
        onMouseDown={(event) => event.preventDefault()}
      >
        <FileText size={ICON_SM} aria-hidden />
        复盘起稿
      </button>
    </Tooltip>
  )

  return (
    <div
      className={'editor-shell'
        + (showReviewStarter ? ' has-review-tools' : '')
        + (reviewContextActive ? ' has-review-context' : '')}
    >
      {editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 120 }}
          className="bubble-menu"
          shouldShow={({ editor: ed, state }) => {
            if (lightboxOpen || readOnly) return false
            if (ed.isActive('image')) return false
            return !state.selection.empty
          }}
        >
          <BtnGroup>
            <BBtn
              on={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold size={ICON_TOOLBAR} />
            </BBtn>
            <BBtn
              on={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic size={ICON_TOOLBAR} />
            </BBtn>
            <BBtn
              on={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough size={ICON_TOOLBAR} />
            </BBtn>
            <BBtn
              on={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code size={ICON_TOOLBAR} />
            </BBtn>
          </BtnGroup>
          <span className="bubble-sep" />
          <BtnGroup>
            <BBtn
              on={editor.isActive('heading', { level: 2 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              <Heading2 size={ICON_TOOLBAR} />
            </BBtn>
            <BBtn
              on={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List size={ICON_TOOLBAR} />
            </BBtn>
            <BBtn
              on={editor.isActive('taskList')}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
            >
              <ListChecks size={ICON_TOOLBAR} />
            </BBtn>
            <BBtn
              on={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote size={ICON_TOOLBAR} />
            </BBtn>
          </BtnGroup>
        </BubbleMenu>
      )}
      {showReviewStarter && editor && !readOnly && (
        <div className="editor-review-tools">
          <Menu
            align="right"
            trigger={reviewButton}
            options={[
              ...reviewTemplates.map((template) => ({
                value: template.id,
                label: template.name,
              })),
            ]}
            onSelect={(value) => {
              const template = reviewTemplates.find((item) => item.id === value)
              if (template) insertReviewTemplate(template.content)
            }}
          />
        </div>
      )}
      <EditorContent
        editor={editor}
        className="editor"
        onErrorCapture={(event) => editor && setEditorImageLoadFailed(editor, event.target, true)}
        onLoadCapture={(event) => editor && setEditorImageLoadFailed(editor, event.target, false)}
      />
    </div>
  )
}

function BtnGroup({ children }: { children: React.ReactNode }) {
  return <div className="bubble-group">{children}</div>
}

function BBtn({
  children,
  on,
  onClick,
}: {
  children: React.ReactNode
  on?: boolean
  onClick: () => void
}) {
  return (
    <button className={'bubble-btn' + (on ? ' is-on' : '')} onClick={onClick}>
      {children}
    </button>
  )
}

// 粘贴/拖入图片：立即持久化到存储，获取可显示的 blob URL，标记 data-asset-id 建立永久关联
async function insertImageFile(
  editor: TiptapEditor,
  file: File,
  noteDraftId?: string,
  existingAssetId?: string,
) {
  if (file.size > MAX_WEB_JOURNAL_ENTRY_BYTES) {
    toast('单张原图超过 32 MB，无法加入资料库；请缩小图片后重试')
    return
  }
  let savedAssetId: string | null = existingAssetId ?? null
  try {
    const storage = getStorage()
    savedAssetId ??= await storage.saveAsset(file, file.type || 'image/png')
    if (editor.isDestroyed) {
      if (noteDraftId) await appendAssetToNoteDraft(noteDraftId, savedAssetId)
      return
    }
    const displayUrl = await storage.getAssetObjectUrl(savedAssetId)
    if (!displayUrl) throw new Error('getAssetObjectUrl returned null')

    if (editor.isDestroyed) {
      if (noteDraftId) await appendAssetToNoteDraft(noteDraftId, savedAssetId)
      return
    }

    editor
      .chain()
      .focus()
      .setImage({ src: displayUrl })
      .updateAttributes('image', { 'data-asset-id': savedAssetId })
      .createParagraphNear()
      .focus()
      .run()
  } catch (e) {
    if (editor.isDestroyed) {
      if (savedAssetId && noteDraftId) {
        try {
          await appendAssetToNoteDraft(noteDraftId, savedAssetId)
        } catch (appendError) {
          console.error('Saved image draft recovery failed', appendError)
        }
      }
      console.error('Image persistence finished after editor was destroyed', e)
      return
    }

    console.error('Image persist failed', e)
    toast('截图保存失败，未插入正文', {
      tone: 'error',
      actionLabel: '重试',
      onAction: () => {
        if (editor.isDestroyed) return
        void trackPendingStorageOperation(
          insertImageFile(editor, file, noteDraftId, savedAssetId ?? undefined),
        )
      },
      dedupeKey: 'editor-image-persist-failed',
    })
  }
}

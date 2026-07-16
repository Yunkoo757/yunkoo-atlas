import { useEditor, EditorContent, BubbleMenu, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { useEffect, useRef } from 'react'
import { getStorage } from '@/storage/bootstrap'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading2,
  List,
  ListChecks,
  Quote,
} from '@/icons/appIcons'
import { ICON_TOOLBAR } from '@/icons/iconSize'
import { useShortcutStore } from '@/store/shortcutStore'
import { collectImageSrcsFromHtml, indexOfImageSrc } from '@/shortcuts/images'
import { ImageLoadFailure, setEditorImageLoadFailed } from './imageLoadFailure'
import { trackPendingStorageOperation } from '@/storage/pendingOperations'
import { appendAssetToNoteDraft } from '@/storage/noteDrafts'
import { MAX_WEB_JOURNAL_ENTRY_BYTES } from '@/lib/webJournalArchiveContract'
import { toast } from '@/lib/toast'
import './Editor.css'

const editorBridge = {
  editor: null as TiptapEditor | null,
  openLightbox: (src: string) => {
    editorBridge.editor?.commands.blur()
    const html = editorBridge.editor?.getHTML() ?? ''
    const images = collectImageSrcsFromHtml(html)
    const list = images.length > 0 ? images : [src]
    useShortcutStore.getState().openLightbox(list, indexOfImageSrc(list, src))
  },
}

export function syncEditorLightboxEditable(
  editor: Pick<TiptapEditor, 'setEditable'>,
  lightboxOpen: boolean,
  readOnly = false,
): void {
  editor.setEditable(!lightboxOpen && !readOnly, false)
}

export function Editor({
  content,
  onChange,
  placeholder = '写下这笔交易的复盘思路… 输入 “- ” 开始清单，“> ” 引用，可直接粘贴/拖入截图',
  readOnly = false,
  noteDraftId,
  allowImages = true,
  ariaLabel,
}: {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  readOnly?: boolean
  noteDraftId?: string
  allowImages?: boolean
  ariaLabel?: string
}) {
  const lightboxOpen = useShortcutStore((s) => s.lightbox !== null)
  const onChangeRef = useRef(onChange)
  const readOnlyRef = useRef(readOnly)
  const editorRef = useRef<TiptapEditor | null>(null)
  const noteDraftIdRef = useRef(noteDraftId)
  const allowImagesRef = useRef(allowImages)
  onChangeRef.current = onChange
  readOnlyRef.current = readOnly
  noteDraftIdRef.current = noteDraftId
  allowImagesRef.current = allowImages
  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
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
      attributes: ariaLabel ? { 'aria-label': ariaLabel } : {},
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
          editorBridge.openLightbox(src)
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
          editorBridge.editor?.chain().focus('end').run()
          return true
        },
      },
    },
    onUpdate: ({ editor }) => {
      if (!readOnlyRef.current) onChangeRef.current(editor.getHTML())
    },
  })

  editorBridge.editor = editor
  editorRef.current = editor

  useEffect(() => {
    if (!editor) return
    syncEditorLightboxEditable(editor, lightboxOpen, readOnly)
  }, [editor, lightboxOpen, readOnly])

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  return (
    <>
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
      <EditorContent
        editor={editor}
        className="editor"
        onErrorCapture={(event) => editor && setEditorImageLoadFailed(editor, event.target, true)}
        onLoadCapture={(event) => editor && setEditorImageLoadFailed(editor, event.target, false)}
      />
    </>
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
async function insertImageFile(editor: TiptapEditor, file: File, noteDraftId?: string) {
  if (file.size > MAX_WEB_JOURNAL_ENTRY_BYTES) {
    toast('单张原图超过 32 MB，无法加入资料库；请缩小图片后重试')
    return
  }
  let savedAssetId: string | null = null
  try {
    const storage = getStorage()
    savedAssetId = await storage.saveAsset(file, file.type || 'image/png')
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

    // 编辑器仍在时保留即时预览；已有永久 ID 时同时绑定，后续不会重复写入图片。
    const url = URL.createObjectURL(file)
    const chain = editor.chain().focus().setImage({ src: url })
    if (savedAssetId) chain.updateAttributes('image', { 'data-asset-id': savedAssetId })
    const inserted = chain.createParagraphNear().focus().run()
    if (!inserted) URL.revokeObjectURL(url)
    console.error('Image persist failed, using blob fallback', e)
  }
}

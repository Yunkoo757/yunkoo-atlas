import { useEditor, EditorContent, BubbleMenu, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { useEffect } from 'react'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading2,
  List,
  ListChecks,
  Quote,
} from 'lucide-react'
import { useShortcutStore } from '@/store/shortcutStore'
import { collectImageSrcsFromHtml, indexOfImageSrc } from '@/shortcuts/images'
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

export function Editor({
  content,
  onChange,
}: {
  content: string
  onChange: (html: string) => void
}) {
  const lightboxOpen = useShortcutStore((s) => s.lightbox !== null)
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder: '写下这笔交易的复盘思路… 输入 “- ” 开始清单，“> ” 引用，可直接粘贴/拖入截图',
      }),
    ],
    content,
    editorProps: {
      handlePaste(_view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const it of Array.from(items)) {
          if (it.type.startsWith('image/')) {
            const file = it.getAsFile()
            if (file && editorBridge.editor) {
              insertImageFile(editorBridge.editor, file)
              return true
            }
          }
        }
        return false
      },
      handleDrop(_view, event) {
        const files = (event as DragEvent).dataTransfer?.files
        if (files && files.length && files[0].type.startsWith('image/')) {
          if (editorBridge.editor) {
            insertImageFile(editorBridge.editor, files[0])
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
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  editorBridge.editor = editor

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!lightboxOpen)
  }, [editor, lightboxOpen])

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
            if (lightboxOpen) return false
            if (ed.isActive('image')) return false
            return !state.selection.empty
          }}
        >
          <BtnGroup>
            <BBtn
              on={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold size={15} />
            </BBtn>
            <BBtn
              on={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic size={15} />
            </BBtn>
            <BBtn
              on={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough size={15} />
            </BBtn>
            <BBtn
              on={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code size={15} />
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
              <Heading2 size={15} />
            </BBtn>
            <BBtn
              on={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List size={15} />
            </BBtn>
            <BBtn
              on={editor.isActive('taskList')}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
            >
              <ListChecks size={15} />
            </BBtn>
            <BBtn
              on={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote size={15} />
            </BBtn>
          </BtnGroup>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} className="editor" />
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

// 粘贴/拖入图片时使用 blob URL，持久化时由 normalizeNoteForStorage 外置为附件。
function insertImageFile(editor: TiptapEditor, file: File) {
  const url = URL.createObjectURL(file)
  editor
    .chain()
    .focus()
    .setImage({ src: url })
    .createParagraphNear()
    .focus()
    .run()
}

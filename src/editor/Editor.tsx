import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
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
import './Editor.css'

export function Editor({
  content,
  onChange,
}: {
  content: string
  onChange: (html: string) => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({
        placeholder: '写下这笔交易的复盘思路… 输入 “- ” 开始清单，“> ” 引用，可直接粘贴/拖入截图',
      }),
    ],
    content,
    editorProps: {
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const it of Array.from(items)) {
          if (it.type.startsWith('image/')) {
            const file = it.getAsFile()
            if (file) {
              insertImageFile(view, file)
              return true
            }
          }
        }
        return false
      },
      handleDrop(view, event) {
        const files = (event as DragEvent).dataTransfer?.files
        if (files && files.length && files[0].type.startsWith('image/')) {
          insertImageFile(view, files[0])
          event.preventDefault()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

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

// 把图片文件读成 base64 data URL 并插入为 image 节点。
function insertImageFile(
  view: { state: any; dispatch: (tr: any) => void },
  file: File,
) {
  const reader = new FileReader()
  reader.onload = () => {
    const src = reader.result
    if (typeof src !== 'string') return
    const { schema } = view.state
    const node = schema.nodes.image?.create({ src })
    if (!node) return
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
  }
  reader.readAsDataURL(file)
}

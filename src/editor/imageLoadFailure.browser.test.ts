import { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import StarterKit from '@tiptap/starter-kit'
import {
  ImageLoadFailure,
  setEditorImageLoadFailed,
} from './imageLoadFailure'
import '../styles/tokens.css'
import './Editor.css'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const testWindow = window as typeof window & {
  __editorImageLoadFailureTest?: Promise<void>
}

testWindow.__editorImageLoadFailureTest = (async () => {
  const wrapper = document.createElement('div')
  wrapper.className = 'editor'
  const element = document.createElement('div')
  wrapper.append(element)
  document.body.append(wrapper)
  let updateCount = 0
  const editor = new Editor({
    element,
    extensions: [StarterKit, Image.configure({ allowBase64: true }), ImageLoadFailure],
    content: '<p>正文前</p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="原始说明"><p>正文后</p>',
    onUpdate: () => {
      updateCount += 1
    },
  })

  try {
    const image = editor.view.dom.querySelector('img')
    assert(image, '真实 Tiptap 编辑器应渲染图片节点')
    const nonImage = editor.view.dom.querySelector('p')
    assert(nonImage, '真实 Tiptap 编辑器应渲染段落节点')
    const originalHtml = editor.getHTML()
    const originalAttributes = {
      src: image.getAttribute('src'),
      alt: image.getAttribute('alt'),
      title: image.getAttribute('title'),
    }

    assert(setEditorImageLoadFailed(editor, image, true), 'IMG 失败事件应被处理')
    assert(editor.getHTML() === originalHtml, '失败 decoration 不得改变 editor.getHTML()')
    assert(updateCount === 0, '失败 decoration 不得触发 onUpdate')
    assert(image.getAttribute('src') === originalAttributes.src, '失败状态不得修改 src')
    assert(image.getAttribute('alt') === originalAttributes.alt, '失败状态不得修改 alt')
    assert(image.getAttribute('title') === originalAttributes.title, '失败状态不得修改 title')
    assert(image.classList.contains('editor-image-load-failed'), '失败图片应获得 node decoration')
    const fallback = editor.view.dom.querySelector<HTMLElement>('.editor-image-load-fallback')
    assert(fallback?.textContent === '图片加载失败', '失败图片原位置应出现中文 widget decoration')
    assert(getComputedStyle(image).display === 'none', '失败图片应由 node decoration 隐藏')
    const fallbackStyle = getComputedStyle(fallback)
    assert(fallbackStyle.display === 'block', '错误占位应作为块级文档流内容显示')
    assert(fallback.getBoundingClientRect().height === 44, '错误占位应保持 44px 轻量高度')
    assert(fallbackStyle.borderTopWidth === '1px', '错误占位应使用 1px 轻边框')
    assert(fallbackStyle.borderTopStyle === 'dashed', '错误占位应使用虚线边框')
    const borderReference = document.createElement('div')
    borderReference.style.borderColor = 'var(--border-strong)'
    document.body.append(borderReference)
    assert(
      fallbackStyle.borderTopColor === getComputedStyle(borderReference).borderTopColor,
      '错误占位应使用 --border-strong 边框色',
    )
    borderReference.remove()

    assert(!setEditorImageLoadFailed(editor, nonImage, true), '非 IMG 事件目标不得被处理')
    assert(editor.getHTML() === originalHtml, '忽略非 IMG 后 HTML 应保持不变')
    assert(updateCount === 0, '忽略非 IMG 不得触发 onUpdate')

    assert(setEditorImageLoadFailed(editor, image, false), '同一 IMG 成功事件应被处理')
    assert(editor.getHTML() === originalHtml, '恢复 decoration 不得改变 editor.getHTML()')
    assert(updateCount === 0, '恢复 decoration 不得触发 onUpdate')
    assert(!editor.view.dom.querySelector('.editor-image-load-failed'), '成功后应清除 node decoration')
    assert(!editor.view.dom.querySelector('.editor-image-load-fallback'), '成功后应清除 widget decoration')
  } finally {
    editor.destroy()
    wrapper.remove()
  }
})()

import { createRoot } from 'react-dom/client'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Editor } from './Editor'

declare global {
  interface Window {
    __reviewContextInteractionTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let latestHtml = ''

  root.render(
    <Editor
      content="<p>4H 顺势，等待回调极端 POI。</p><p>15m 出现结构确认。</p><img src='https://example.invalid/chart.png'>"
      onChange={(html) => { latestHtml = html }}
      reviewContextTools
      reviewContextPinned
    />,
  )
  await waitFor(
    () => Boolean(host.querySelector('section[data-review-context]')),
    '全局固定模式未自动生成盘面摘要',
  )

  const context = host.querySelector<HTMLElement>('section[data-review-context]')
  assert(context, '固定后必须生成盘面摘要容器')
  assert(context.querySelectorAll(':scope > p').length === 2, '摘要只应包含截图前的开头文字')
  assert(context.nextElementSibling?.tagName === 'IMG', '截图必须留在摘要区下方')
  const contextStyle = getComputedStyle(context)
  assert(contextStyle.position === 'sticky', '盘面摘要必须在浏览截图时保持可见')
  assert(contextStyle.overflowY !== 'auto' && contextStyle.overflowY !== 'scroll', '盘面摘要不得出现内部滚动条')
  assert(contextStyle.boxShadow === 'none', '盘面摘要应与正文连续，不得呈现浮窗阴影')
  assert(latestHtml.includes('data-review-context="true"'), '固定状态必须保存在同一份复盘笔记中')
  assert(!host.querySelector('.editor-review-tools'), '已有正文时不应继续显示逐笔固定操作')

  root.render(
    <Editor
      content={latestHtml}
      onChange={(html) => { latestHtml = html }}
      reviewContextTools
      reviewContextPinned={false}
    />,
  )
  await waitFor(
    () => !host.querySelector('section[data-review-context]'),
    '全局不固定模式未自动恢复普通正文',
  )
  assert(!host.querySelector('section[data-review-context]'), '取消固定后不得残留摘要容器')
  assert(host.querySelector('.ProseMirror')?.children[2]?.tagName === 'IMG', '取消固定不得改变图文顺序')

  root.render(
    <Editor
      content="<img src='https://example.invalid/image-first.png'>"
      onChange={() => {}}
      reviewContextTools
      reviewTemplates={[{ id: 'test-template', name: '测试模板', content: '背景：' }]}
    />,
  )
  await waitFor(
    () => Boolean(host.querySelector('.editor-review-tools')),
    '图片开头的空白复盘应显示起稿入口',
  )
  const starterTools = host.querySelector<HTMLElement>('.editor-review-tools')
  assert(starterTools && getComputedStyle(starterTools).position !== 'absolute', '复盘起稿入口不得覆盖在截图内部')

  const editable = host.querySelector<HTMLElement>('.ProseMirror')
  const tiptapEditor = (editable as (HTMLElement & { editor?: TiptapEditor }) | null)?.editor
  tiptapEditor?.destroy()
  host.remove()
}

window.__reviewContextInteractionTest = run()

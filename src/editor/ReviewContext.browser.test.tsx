import { createRoot } from 'react-dom/client'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Editor } from './Editor'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __reviewContextInteractionTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertFontFamily(element: Element, expectedFamily: string, message: string): void {
  assert(getComputedStyle(element).fontFamily.includes(expectedFamily), `${message}，实际 ${getComputedStyle(element).fontFamily}`)
}

function assertReviewContextTypography(context: HTMLElement): void {
  const contextStyle = getComputedStyle(context)
  const labelStyle = getComputedStyle(context, '::before')
  const ordinaryText = context.querySelector<HTMLElement>('p')
  const keySentence = context.querySelector<HTMLElement>('strong')
  assertFontFamily(context, 'Inter Variable', '盘面摘要容器必须使用 UI 字体')
  assert(contextStyle.fontSize === '15px', `盘面摘要正文必须使用 Body 15px，实际 ${contextStyle.fontSize}`)
  assert(contextStyle.fontWeight === '400', `盘面摘要正文必须使用正常字重，实际 ${contextStyle.fontWeight}`)
  assert(contextStyle.lineHeight === '23px', `盘面摘要正文必须使用 Body 行高，实际 ${contextStyle.lineHeight}`)
  assert(labelStyle.fontSize === '12px', `盘面摘要标签必须使用 Metadata 12px，实际 ${labelStyle.fontSize}`)
  assert(labelStyle.fontWeight === '500', `盘面摘要标签必须使用 Metadata 字重，实际 ${labelStyle.fontWeight}`)
  assert(labelStyle.lineHeight === '16px', `盘面摘要标签必须使用 Metadata 行高，实际 ${labelStyle.lineHeight}`)
  assert(ordinaryText && getComputedStyle(ordinaryText).fontWeight === '400', '普通摘要正文必须保持 Body/normal')
  assert(keySentence && getComputedStyle(keySentence).fontWeight === '500', '摘要关键句必须使用 Body/500')
}

function assertFontInheritance(context: HTMLElement): void {
  const ordinaryText = context.querySelector<HTMLElement>('p')
  const inlineCode = context.querySelector<HTMLElement>('code')
  assert(ordinaryText && inlineCode, '真实 TipTap 摘要必须提供普通文本与 inline code 节点')
  const normal = document.createElement('span')
  normal.textContent = ' UI span'
  ordinaryText.append(normal)
  const inlineCodeDescendant = document.createElement('span')
  inlineCodeDescendant.textContent = ' mono descendant'
  inlineCode.append(inlineCodeDescendant)
  const pre = document.createElement('pre')
  const preCode = document.createElement('code')
  const preDescendant = document.createElement('span')
  preDescendant.textContent = 'pre descendant'
  preCode.append(preDescendant)
  pre.append(preCode)
  context.append(pre)
  assertFontFamily(normal, 'Inter Variable', '普通 span 必须继承 UI 字体')
  assertFontFamily(inlineCodeDescendant, 'JetBrains Mono', 'inline code 后代必须使用 mono 字体')
  assertFontFamily(preDescendant, 'JetBrains Mono', 'pre 后代必须使用 mono 字体')
  normal.remove()
  inlineCodeDescendant.remove()
  pre.remove()
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
      content="<p><strong>关键句：</strong>4H 顺势，等待 <code>POI</code> 回调。</p><p>15m 出现结构确认。</p><img src='/src/views/fixtures/browser-test-image.svg?chart.png'><p>等待下一次回调确认。</p>"
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
  const image = context?.nextElementSibling as HTMLImageElement | null
  const followingParagraph = image?.nextElementSibling as HTMLParagraphElement | null
  assert(context && image?.tagName === 'IMG', '首图必须保持在摘要之后')
  assert(followingParagraph?.tagName === 'P', '图片后的正文必须保持原有顺序')
  assert(context.querySelectorAll(':scope > p').length === 2, '摘要只应包含截图前的开头文字')
  assertReviewContextTypography(context)
  assertFontInheritance(context)
  const gap = image.getBoundingClientRect().top - context.getBoundingClientRect().bottom
  assert(Math.abs(gap - 16) <= 1, `摘要到首图应为 16px，实际 ${gap}px`)
  const followingGap = followingParagraph.getBoundingClientRect().top - image.getBoundingClientRect().bottom
  assert(Math.abs(followingGap - 16) <= 1, `图片到后续正文应为 16px，实际 ${followingGap}px`)
  const contextStyle = getComputedStyle(context)
  assert(Math.abs(Number.parseFloat(contextStyle.marginBottom) - 16) <= 1, '摘要自身的下方节奏必须统一为 16px')
  assert(contextStyle.position === 'sticky', '盘面摘要必须在浏览截图时保持可见')
  assert(contextStyle.overflowY !== 'auto' && contextStyle.overflowY !== 'scroll', '盘面摘要不得出现内部滚动条')
  assert(contextStyle.backgroundColor === 'rgba(0, 0, 0, 0)', '盘面摘要必须使用透明背景')
  assert(
    [contextStyle.borderTopWidth, contextStyle.borderRightWidth, contextStyle.borderBottomWidth, contextStyle.borderLeftWidth]
      .every((width) => Number.parseFloat(width) === 0),
    '盘面摘要不得保留容器边框',
  )
  assert(contextStyle.boxShadow === 'none', '盘面摘要应与正文连续，不得呈现浮窗阴影')
  assert(latestHtml.includes('data-review-context="true"'), '保存 HTML 必须保留摘要数据节点')
  assert(latestHtml.indexOf('data-review-context') < latestHtml.indexOf('<img'), '保存 HTML 不得改变摘要与图片顺序')
  assert(latestHtml.indexOf('<img') < latestHtml.indexOf('等待下一次回调确认。'), '保存 HTML 不得改变图片与后续正文顺序')
  assert(!host.querySelector('.editor-review-tools'), '已有正文时不应继续显示逐笔固定操作')

  const activeEditable = host.querySelector<HTMLElement>('.ProseMirror')
  const activeEditor = (activeEditable as (HTMLElement & { editor?: TiptapEditor }) | null)?.editor
  const savedHtml = activeEditor?.getHTML()
  assert(savedHtml === latestHtml, '字体探针不得改变 TipTap 保存 HTML')

  root.render(
    <Editor
      content={savedHtml ?? ''}
      onChange={(html) => { latestHtml = html }}
      readOnly
      reviewContextTools
      reviewContextPinned
    />,
  )
  await waitFor(
    () => Boolean(host.querySelector('section[data-review-context]')),
    '只读编辑器必须保留盘面摘要',
  )
  const readonlyContext = host.querySelector<HTMLElement>('section[data-review-context]')
  assert(readonlyContext, '只读编辑器必须渲染盘面摘要')
  assertReviewContextTypography(readonlyContext)
  assertFontInheritance(readonlyContext)
  const readonlyEditable = host.querySelector<HTMLElement>('.ProseMirror')
  const readonlyEditor = (readonlyEditable as (HTMLElement & { editor?: TiptapEditor }) | null)?.editor
  assert(readonlyEditor?.getHTML() === savedHtml, '只读字体渲染不得改写保存 HTML')

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
  const restoredChildren = host.querySelector('.ProseMirror')?.children
  assert(restoredChildren?.[2]?.tagName === 'IMG' && restoredChildren[3]?.textContent === '等待下一次回调确认。', '取消固定不得改变图文顺序')

  latestHtml = ''
  const renderBlankEditor = (content: string) => {
    root.render(
      <Editor
        content={content}
        onChange={(html) => {
          latestHtml = html
          renderBlankEditor(html)
        }}
        reviewContextTools
        reviewContextPinned
      />,
    )
  }
  renderBlankEditor('')
  await waitFor(
    () => Boolean(
      (host.querySelector<HTMLElement>('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null)?.editor,
    ),
    '空白复盘编辑器未就绪',
  )
  const blankEditable = host.querySelector<HTMLElement>('.ProseMirror')
  const blankEditor = (blankEditable as (HTMLElement & { editor?: TiptapEditor }) | null)?.editor
  await waitForFrame()
  blankEditor?.chain().focus('end').insertContent('Q').run()
  await waitForFrame()
  blankEditor?.commands.insertContent('A')
  await waitForFrame()
  assert(!host.querySelector('section[data-review-context]'), '空白复盘输入首字时不得立即重排为固定摘要')
  assert(blankEditable?.textContent === 'QA', '连续输入不得因默认固定模式拆分首字符')

  root.render(
    <Editor
      content="<img src='/src/views/fixtures/browser-test-image.svg?image-first.png'>"
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
  host.querySelector<HTMLButtonElement>('button[aria-label="选择复盘起稿"]')?.click()
  await waitFor(
    () => Boolean(document.body.querySelector('.menu-pop')),
    '点击复盘起稿后应显示模板菜单',
  )
  const starterOptions = Array.from(document.body.querySelectorAll('.menu-item-label'))
    .map((item) => item.textContent?.trim())
  assert(starterOptions.includes('测试模板'), '复盘起稿菜单应保留模板选择')
  assert(!starterOptions.some((label) => label?.includes('管理起稿模板')), '复盘起稿菜单不得放置模板管理入口')
  assert(!starterOptions.some((label) => label?.includes('新建起稿模板')), '复盘起稿菜单不得放置模板新建入口')

  const editable = host.querySelector<HTMLElement>('.ProseMirror')
  const tiptapEditor = (editable as (HTMLElement & { editor?: TiptapEditor }) | null)?.editor
  tiptapEditor?.destroy()
  host.remove()
}

window.__reviewContextInteractionTest = run()

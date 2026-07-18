import {
  REVIEW_STARTER_LABELS,
  hasLeadingReviewParagraphs,
  hasReviewContextDocument,
  toggleReviewContextDocument,
} from './reviewContext'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testReviewContextBuildsAStarterWithoutOverwritingTheDocument() {
  const result = toggleReviewContextDocument({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })

  assert(hasReviewContextDocument(result), '空白笔记应插入可固定的复盘起稿')
  assert(result.content?.[0]?.content?.length === REVIEW_STARTER_LABELS.length, '起稿字段数量不正确')
  assert(result.content?.[1]?.type === 'paragraph', '起稿后必须保留可继续录入正文的位置')
}

export function testReviewContextWrapsOnlyLeadingNarrativeAndKeepsImagesBelow() {
  const original = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'HTF 顺势' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '等待 LTF 确认' }] },
      { type: 'image', attrs: { src: 'journal-asset://chart' } },
    ],
  }
  assert(hasLeadingReviewParagraphs(original), '测试数据应识别出开头盘面叙述')

  const pinned = toggleReviewContextDocument(original)
  assert(pinned.content?.[0]?.type === 'reviewContext', '开头文字应进入固定摘要区')
  assert(pinned.content?.[0]?.content?.length === 2, '固定摘要不得吞掉截图')
  assert(pinned.content?.[1]?.type === 'image', '截图顺序必须保持不变')

  const restored = toggleReviewContextDocument(pinned)
  assert(!hasReviewContextDocument(restored), '取消固定后不得残留摘要容器')
  assert(restored.content?.[0]?.type === 'paragraph' && restored.content?.[2]?.type === 'image', '取消固定不得改写原始图文顺序')
}

export function testReviewContextBuildsTheSelectedCustomTemplate() {
  const result = toggleReviewContextDocument({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }, '计划：只做回调\n风险管理：0.5R 后保护')

  const context = result.content?.[0]
  assert(context?.type === 'reviewContext', '自定义模板应直接进入固定摘要区')
  assert(context.content?.length === 2, '模板每一行应形成一个独立段落')
  assert(context.content?.[0]?.content?.[0]?.marks?.[0]?.type === 'bold', '冒号前的模板标签应自动加粗')
}

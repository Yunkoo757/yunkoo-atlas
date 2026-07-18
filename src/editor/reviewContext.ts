import { Node, mergeAttributes, type JSONContent } from '@tiptap/core'

export const REVIEW_STARTER_LABELS = ['HTF 背景', 'MTF 触发', 'LTF 执行', '复盘结论'] as const

export const ReviewContext = Node.create({
  name: 'reviewContext',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'section[data-review-context]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-review-context': 'true' }),
      0,
    ]
  },
})

function nodeText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(nodeText).join('')
}

function reviewStarterParagraph(label: string): JSONContent {
  return {
    type: 'paragraph',
    content: [{
      type: 'text',
      text: `${label}：`,
      marks: [{ type: 'bold' }],
    }],
  }
}

function reviewTemplateParagraph(line: string): JSONContent {
  const match = /^([^：:]{1,32}[：:])(.*)$/.exec(line)
  if (!match) {
    return line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' }
  }
  const content: JSONContent[] = [{
    type: 'text',
    text: match[1],
    marks: [{ type: 'bold' }],
  }]
  if (match[2]) content.push({ type: 'text', text: match[2] })
  return { type: 'paragraph', content }
}

function reviewTemplateParagraphs(templateContent?: string): JSONContent[] {
  if (templateContent === undefined) return REVIEW_STARTER_LABELS.map(reviewStarterParagraph)
  const lines = templateContent.replace(/\r\n?/g, '\n').split('\n')
  return lines.length > 0 ? lines.map(reviewTemplateParagraph) : [{ type: 'paragraph' }]
}

export function hasReviewContextDocument(doc: JSONContent): boolean {
  return (doc.content ?? []).some((node) => node.type === 'reviewContext')
}

export function hasLeadingReviewParagraphs(doc: JSONContent): boolean {
  const first = doc.content?.[0]
  return first?.type === 'paragraph' && nodeText(first).trim().length > 0
}

export function toggleReviewContextDocument(doc: JSONContent, templateContent?: string): JSONContent {
  const content = doc.content ?? []
  const contextIndex = content.findIndex((node) => node.type === 'reviewContext')

  if (contextIndex >= 0) {
    const context = content[contextIndex]!
    return {
      ...doc,
      content: [
        ...content.slice(0, contextIndex),
        ...(context.content ?? []),
        ...content.slice(contextIndex + 1),
      ],
    }
  }

  let leadingCount = 0
  while (
    content[leadingCount]?.type === 'paragraph' &&
    nodeText(content[leadingCount]!).trim().length > 0
  ) {
    leadingCount += 1
  }

  const contextContent = leadingCount > 0
    ? content.slice(0, leadingCount)
    : reviewTemplateParagraphs(templateContent)
  let remainder = content.slice(leadingCount)
  if (leadingCount === 0 && remainder.length === 1 && !nodeText(remainder[0]!).trim()) {
    remainder = []
  }
  if (remainder.length === 0) remainder = [{ type: 'paragraph' }]

  return {
    ...doc,
    content: [
      { type: 'reviewContext', content: contextContent },
      ...remainder,
    ],
  }
}

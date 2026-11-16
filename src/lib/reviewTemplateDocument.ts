import type { JSONContent } from '@tiptap/core'

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

export function reviewTemplateParagraphs(templateContent?: string): JSONContent[] {
  if (templateContent === undefined) return ['HTF 背景', 'MTF 触发', 'LTF 执行', '复盘结论'].map(label => reviewTemplateParagraph(`${label}：`))
  const lines = templateContent.replace(/\r\n?/g, '\n').split('\n')
  return lines.length > 0 ? lines.map(reviewTemplateParagraph) : [{ type: 'paragraph' }]
}


import { stripNoteToPlainText } from './tradeDuplicates'
import type { Trade } from '@/data/trades'

/** 来源复盘与独立沉淀保持分离；这里只选择预览，不写回任何字段。 */
export function resolveCasePreview(trade: Pick<Trade, 'note' | 'sourceNoteHtml'>) {
  const read = (html: string) => ({ excerpt: caseExcerpt(html), imageCount: html.match(/<img\b/gi)?.length ?? 0 })
  const own = read(trade.note)
  if (own.excerpt || own.imageCount) return { ...own, source: 'note' as const }
  const source = read(trade.sourceNoteHtml ?? '')
  if (source.excerpt || source.imageCount) return { ...source, source: 'source' as const }
  return { ...own, source: 'empty' as const }
}

export function casePreviewSummary(preview: ReturnType<typeof resolveCasePreview>): string {
  if (preview.source === 'empty') return ''
  const content = preview.excerpt || `${preview.imageCount} 张截图`
  return preview.source === 'source' ? `来源复盘 · ${content}` : content
}

/** 从已有正文提取题眼，不生成新内容、不读取图片附件。 */
export function caseExcerpt(html: string, maxLength = 160): string {
  const content = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  const isMeaningful = (text: string) => text.length > 0
    && !/^(?:HTF 背景|MTF 触发|LTF 执行|复盘结论)\s*[：:]?$/.test(text)
  const headings = [...content.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
    .map((match) => stripNoteToPlainText(match[1]))
  const paragraphs = [...content.matchAll(/<(?:p|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:p|li|blockquote)>/gi)]
    .map((match) => stripNoteToPlainText(match[1]))
  const text = headings.find(isMeaningful) ?? paragraphs.find(isMeaningful)
    ?? stripNoteToPlainText(content)
  if (!isMeaningful(text)) return ''
  const characters = Array.from(text)
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join('')}…` : text
}

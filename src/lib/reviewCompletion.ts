import { stripNoteToPlainText } from './tradeDuplicates'

export type ReviewCompletionReason = 'empty'

export type ReviewCompletionResult =
  | { ready: true; reason: null }
  | { ready: false; reason: ReviewCompletionReason }

function countImages(html: string): number {
  return html.match(/<img\b/gi)?.length ?? 0
}

function stripReviewStarterLabels(text: string): string {
  return text
    .replace(/(?:HTF 背景|MTF 触发|LTF 执行|复盘结论)\s*[：:]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function evaluateReviewCompletion(noteHtml: string): ReviewCompletionResult {
  const noteText = stripReviewStarterLabels(stripNoteToPlainText(noteHtml))
  if (!noteText && countImages(noteHtml) === 0) {
    return { ready: false, reason: 'empty' }
  }

  return { ready: true, reason: null }
}

import { stripNoteToPlainText } from './tradeDuplicates'

export type ReviewCompletionReason = 'empty' | 'template-only'

export type ReviewCompletionResult =
  | { ready: true; reason: null }
  | { ready: false; reason: ReviewCompletionReason }

function countCheckedItems(html: string): number {
  return html.match(/data-checked=["']true["']/gi)?.length ?? 0
}

function countImages(html: string): number {
  return html.match(/<img\b/gi)?.length ?? 0
}

export function evaluateReviewCompletion(
  noteHtml: string,
  templateHtml?: string,
): ReviewCompletionResult {
  const noteText = stripNoteToPlainText(noteHtml)
  if (!noteText && countImages(noteHtml) === 0) {
    return { ready: false, reason: 'empty' }
  }

  if (templateHtml && noteText === stripNoteToPlainText(templateHtml)) {
    if (
      countCheckedItems(noteHtml) === countCheckedItems(templateHtml) &&
      countImages(noteHtml) === countImages(templateHtml)
    ) {
      return { ready: false, reason: 'template-only' }
    }
  }

  return { ready: true, reason: null }
}

import { stripNoteToPlainText } from './tradeDuplicates'

export type ReviewCompletionReason = 'empty'

export type ReviewCompletionResult =
  | { ready: true; reason: null }
  | { ready: false; reason: ReviewCompletionReason }

function countImages(html: string): number {
  return html.match(/<img\b/gi)?.length ?? 0
}

export function evaluateReviewCompletion(noteHtml: string): ReviewCompletionResult {
  const noteText = stripNoteToPlainText(noteHtml)
  if (!noteText && countImages(noteHtml) === 0) {
    return { ready: false, reason: 'empty' }
  }

  return { ready: true, reason: null }
}

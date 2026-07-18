import { evaluateReviewCompletion } from './reviewCompletion'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testReviewCompletionRejectsAnEmptyNote() {
  const result = evaluateReviewCompletion('')

  assert(result.ready === false, '空白笔记不能完成复盘')
  assert(result.reason === 'empty', '应明确提示缺少复盘内容')
}

export function testReviewCompletionAcceptsWrittenReflection() {
  const result = evaluateReviewCompletion('<p>这笔交易追价，下次等待回踩确认。</p>')

  assert(result.ready === true, '写下复盘结论后应允许完成复盘')
}

export function testReviewCompletionAcceptsScreenshotEvidence() {
  const result = evaluateReviewCompletion('<p></p><img src="journal-asset://review-chart" alt="复盘图表">')

  assert(result.ready === true, '复盘截图本身也应视为有效复盘证据')
}

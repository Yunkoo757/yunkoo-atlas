import { evaluateReviewCompletion } from './reviewCompletion'
import {
  BUILTIN_REVIEW_TEMPLATES,
  DEFAULT_REVIEW_TEMPLATE_HTML,
  resolveReviewTemplateHtml,
} from './reviewTemplates'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testReviewCompletionRejectsAnEmptyNote() {
  const result = evaluateReviewCompletion('')

  assert(result.ready === false, '空白笔记不能完成复盘')
  assert(result.reason === 'empty', '应明确提示缺少复盘内容')
}

export function testReviewCompletionRejectsAnUnchangedTemplate() {
  const template = '<p><strong>计划与实际</strong></p><p>实际执行：</p>'
  const result = evaluateReviewCompletion(template, template)

  assert(result.ready === false, '原样套用模板不能完成复盘')
  assert(result.reason === 'template-only', '应明确提示模板尚未填写')
}

export function testReviewCompletionAcceptsACompletedTemplateChecklist() {
  const template = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">按计划执行？</li></ul>'
  const completed = template.replace('data-checked="false"', 'data-checked="true"')
  const result = evaluateReviewCompletion(completed, template)

  assert(result.ready === true, '勾选模板检查项后应允许完成复盘')
}

export function testReviewCompletionAcceptsScreenshotEvidence() {
  const result = evaluateReviewCompletion('<p></p><img src="journal-asset://review-chart" alt="复盘图表">')

  assert(result.ready === true, '复盘截图本身也应视为有效复盘证据')
}

export function testDefaultReviewTemplateIsDesignedForPostTradeReflection() {
  const postTradeTemplate = BUILTIN_REVIEW_TEMPLATES.find((template) => template.id === 'post-trade')

  assert(postTradeTemplate, '应提供盘后复盘模板')
  assert(
    DEFAULT_REVIEW_TEMPLATE_HTML === postTradeTemplate.html,
    '策略的默认复盘结构应使用盘后复盘，而不是进场检查清单',
  )
}

export function testReviewTemplateResolutionPrefersStrategyThenTradeContext() {
  const custom = '<p>我的策略复盘结构</p>'
  const missed = BUILTIN_REVIEW_TEMPLATES.find((template) => template.id === 'missed-review')

  assert(resolveReviewTemplateHtml(custom, true) === custom, '策略自定义模板应优先使用')
  assert(missed, '应提供错过机会复盘模板')
  assert(
    resolveReviewTemplateHtml(undefined, true) === missed.html,
    '错过机会且没有策略模板时应使用对应复盘结构',
  )
}

export function testReviewTemplateResolutionSurvivesMalformedLegacyData() {
  const malformed = 42 as unknown as string

  assert(
    resolveReviewTemplateHtml(malformed) === DEFAULT_REVIEW_TEMPLATE_HTML,
    '异常历史模板字段应回退默认结构，不能让详情页崩溃',
  )
}

export function testReviewTemplateResolutionTreatsEmptyEditorHtmlAsBlank() {
  assert(
    resolveReviewTemplateHtml('<p></p>') === DEFAULT_REVIEW_TEMPLATE_HTML,
    'TipTap 的空文档 HTML 不能被误认成策略模板',
  )
}

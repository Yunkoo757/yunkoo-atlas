/** 内置复盘模板（TipTap HTML） */

export const BUILTIN_REVIEW_TEMPLATES: { id: string; label: string; html: string }[] = [
  {
    id: 'entry-checklist',
    label: '进场检查清单',
    html: `<p><strong>进场逻辑</strong></p><ul data-type="taskList"><li data-type="taskItem" data-checked="false">符合策略定义？</li><li data-type="taskItem" data-checked="false">风险回报比 ≥ 1:2？</li><li data-type="taskItem" data-checked="false">止损位置明确？</li><li data-type="taskItem" data-checked="false">仓位符合风控？</li></ul>`,
  },
  {
    id: 'post-trade',
    label: '盘后复盘',
    html: `<h2>计划与实际</h2><p><strong>原计划：</strong></p><p><strong>实际执行：</strong></p><h2>决策与偏差</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false">入场符合策略定义</li><li data-type="taskItem" data-checked="false">仓位与止损符合风控</li><li data-type="taskItem" data-checked="false">退出遵循原计划</li></ul><p><strong>主要偏差 / 根因：</strong></p><h2>下一次行动</h2><blockquote>下次我会：</blockquote>`,
  },
  {
    id: 'missed-review',
    label: '错过机会复盘',
    html: `<p><strong>为何未执行</strong></p><p></p><p><strong>假设结果</strong></p><p></p><blockquote>下次改进：</blockquote>`,
  },
]

export const DEFAULT_REVIEW_TEMPLATE_HTML = BUILTIN_REVIEW_TEMPLATES.find(
  (template) => template.id === 'post-trade',
)!.html

const MISSED_REVIEW_TEMPLATE_HTML = BUILTIN_REVIEW_TEMPLATES.find(
  (template) => template.id === 'missed-review',
)!.html

export function hasMeaningfulReviewTemplate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length > 0
}

export function resolveReviewTemplateHtml(
  strategyTemplateHtml?: string,
  isMissedTrade = false,
): string {
  const customTemplate = hasMeaningfulReviewTemplate(strategyTemplateHtml)
    ? strategyTemplateHtml.trim()
    : ''
  if (customTemplate) return customTemplate
  return isMissedTrade ? MISSED_REVIEW_TEMPLATE_HTML : DEFAULT_REVIEW_TEMPLATE_HTML
}

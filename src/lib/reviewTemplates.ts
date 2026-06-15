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
    html: `<p><strong>执行</strong></p><p>实际进场 vs 计划：</p><p><strong>情绪</strong></p><p></p><blockquote>教训：</blockquote>`,
  },
  {
    id: 'missed-review',
    label: '错过机会复盘',
    html: `<p><strong>为何未执行</strong></p><p></p><p><strong>假设结果</strong></p><p></p><blockquote>下次改进：</blockquote>`,
  },
]

export const DEFAULT_REVIEW_TEMPLATE_HTML = BUILTIN_REVIEW_TEMPLATES[0].html

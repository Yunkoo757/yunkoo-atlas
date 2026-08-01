import { readFileSync } from 'node:fs'
import path from 'node:path'

function riskRuleBlocks(source: string): string[] {
  const blocks: string[] = []
  const starts = /([^{}]+)\{/g
  let match: RegExpExecArray | null
  while ((match = starts.exec(source)) !== null) {
    if (!match[1]?.includes('.wr-risk-')) continue
    const open = match.index + match[0].lastIndexOf('{')
    let depth = 0
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      if (source[index] !== '}') continue
      depth -= 1
      if (depth === 0) {
        blocks.push(source.slice(match.index, index + 1))
        break
      }
    }
  }
  return blocks
}

export function testWeeklyRiskStylesUseOnlyApprovedDesignRoles(): void {
  const css = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8').replace(/\r\n?/g, '\n')
  const riskCss = riskRuleBlocks(css).join('\n')
  for (const forbidden of [/#(?:[\da-f]{3}){1,2}\b/i, /\brgba?\(/i, /\bhsla?\(/i, /\b(?:ok)?lch\(/i, /box-shadow\s*:/i]) {
    if (forbidden.test(riskCss)) throw new Error(`风控区出现私有视觉值：${forbidden}`)
  }
  for (const declaration of ['font-size', 'gap', 'padding', 'margin', 'border-radius']) {
    const rawValue = new RegExp(`${declaration}\\s*:\\s*(?!var\\(--)[^;]+;`, 'g')
    if (rawValue.test(riskCss)) throw new Error(`${declaration} 必须直接消费 token`)
  }
  for (const token of ['--bg-elevated', '--bg-inset', '--border-subtle', '--text-strong', '--text-muted', '--font-mono']) {
    if (!riskCss.includes(`var(${token})`)) throw new Error(`缺少设计角色 ${token}`)
  }
  if (css.includes('.wr-risk-evidence .wr-metric-grid')) throw new Error('风控区不得继续使用指标网格')
}

export function testWeeklyRiskStylesTargetTheEvidenceDom(): void {
  const css = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8').replace(/\r\n?/g, '\n')
  const riskCss = riskRuleBlocks(css)
  const dailyValueRule = riskCss.find((block) => block.includes('.wr-risk-day strong')) ?? ''
  const auditContentRule = riskCss.find(
    (block) => block.includes('.wr-risk-audit p') && block.includes('.wr-risk-audit article'),
  ) ?? ''

  if (!dailyValueRule.includes('font-family: var(--font-mono)') || !dailyValueRule.includes('font-variant-numeric: tabular-nums')) {
    throw new Error('每日风险的实际 strong 元素必须继承等宽数字样式')
  }
  for (const declaration of [
    'padding-block-end: var(--sp-4)',
    'color: var(--text-muted)',
    'font-size:var(--type-metadata-size)',
  ]) {
    if (!auditContentRule.includes(declaration)) {
      throw new Error(`审计实际内容必须保留详情样式：${declaration}`)
    }
  }
}

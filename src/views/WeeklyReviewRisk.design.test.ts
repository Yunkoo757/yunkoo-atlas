import { readFileSync } from 'node:fs'
import path from 'node:path'

function stripCssBlockComments(source: string): string {
  let result = ''
  let index = 0
  let quote: '"' | "'" | null = null

  while (index < source.length) {
    const character = source[index]!
    if (quote !== null) {
      result += character
      if (character === '\\' && index + 1 < source.length) {
        result += source[index + 1]
        index += 2
        continue
      }
      if (character === quote) quote = null
      index += 1
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      result += character
      index += 1
      continue
    }
    if (character !== '/' || source[index + 1] !== '*') {
      result += character
      index += 1
      continue
    }

    result += ' '
    index += 2
    let closed = false
    while (index < source.length) {
      if (source[index] === '*' && source[index + 1] === '/') {
        index += 2
        closed = true
        break
      }
      if (source[index] === '\r' || source[index] === '\n') result += source[index]
      index += 1
    }
    if (!closed) throw new Error('CSS 注释缺少结束标记')
  }

  return result
}

function riskRuleBlocks(source: string): string[] {
  source = stripCssBlockComments(source)
  const blocks: string[] = []
  function closingBrace(open: number, end: number): number {
    let depth = 0
    for (let index = open; index < end; index += 1) {
      if (source[index] === '{') depth += 1
      if (source[index] === '}') {
        depth -= 1
        if (depth === 0) return index
      }
    }
    throw new Error('CSS 规则缺少结束花括号')
  }

  function collect(start: number, end: number): void {
    let cursor = start
    while (cursor < end) {
      const open = source.indexOf('{', cursor)
      if (open < 0 || open >= end) return
      const close = closingBrace(open, end)
      const selector = source.slice(cursor, open).trim()
      if (selector.startsWith('@')) collect(open + 1, close)
      else if (selector.includes('.wr-risk-')) blocks.push(source.slice(cursor, close + 1))
      cursor = close + 1
    }
  }

  collect(0, source.length)
  return blocks
}

const APPROVED_RISK_TOKENS = new Set([
  '--accent', '--bg-elevated', '--bg-inset', '--bg-surface', '--border-strong', '--border-subtle',
  '--font-ui', '--font-weight-semibold', '--neg', '--numeric-tabular', '--pos', '--radius-6', '--radius-8', '--risk-progress',
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--text-body', '--text-muted', '--text-strong',
  '--type-body-size', '--type-metadata-size', '--type-section-title-size', '--warn',
])
const APPROVED_RISK_COLOR_TOKENS = new Set([
  '--accent', '--bg-elevated', '--bg-inset', '--bg-surface', '--border-strong', '--border-subtle',
  '--neg', '--pos', '--text-body', '--text-muted', '--text-strong', '--warn',
])
const REQUIRED_RISK_TOKENS = ['--bg-inset', '--border-subtle', '--text-strong', '--text-muted', '--font-ui', '--numeric-tabular']
const TOKEN_ONLY_PROPERTIES = new Set([
  'font-size', 'gap', 'row-gap', 'column-gap', 'padding', 'padding-block', 'padding-inline',
  'padding-block-start', 'padding-block-end', 'padding-inline-start', 'padding-inline-end',
  'margin', 'margin-block', 'margin-inline', 'margin-block-start', 'margin-block-end',
  'margin-inline-start', 'margin-inline-end', 'border-radius',
])
const COLOR_PROPERTIES = new Set([
  'color', 'background', 'background-color', 'border', 'border-color', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-block', 'border-inline', 'border-block-start', 'border-block-end',
  'border-inline-start', 'border-inline-end', 'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color', 'border-block-color', 'border-inline-color', 'border-block-start-color',
  'border-block-end-color', 'border-inline-start-color', 'border-inline-end-color', 'outline', 'outline-color',
  'text-decoration', 'text-decoration-color', 'caret-color', 'fill', 'stroke', 'column-rule',
  'column-rule-color', 'text-emphasis', 'text-emphasis-color', '-webkit-text-fill-color',
  '-webkit-text-stroke', '-webkit-text-stroke-color', 'accent-color', 'scrollbar-color',
])

function declarations(rule: string): Array<{ property: string, value: string }> {
  rule = stripCssBlockComments(rule)
  const open = rule.indexOf('{')
  const close = rule.lastIndexOf('}')
  if (open < 0 || close < open) throw new Error('CSS 风控规则缺少花括号')
  const result: Array<{ property: string, value: string }> = []
  const matches = /(?:^|;)\s*([\w-]+)\s*:\s*([^;{}]+)(?=;|$)/g
  let match: RegExpExecArray | null
  const body = rule.slice(open + 1, close)
  while ((match = matches.exec(body)) !== null) {
    result.push({ property: match[1]!.trim().toLowerCase(), value: match[2]!.trim() })
  }
  return result
}

function assertRiskColorUsesApprovedTokens(property: string, value: string): void {
  if (!COLOR_PROPERTIES.has(property)) return
  if (/\bcurrentcolor\b/i.test(value)) throw new Error(`${property} 不得使用 currentColor`)
  if (/#(?:[\da-f]{3,8})\b/i.test(value)) throw new Error(`${property} 不得使用私有十六进制颜色`)
  for (const token of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!APPROVED_RISK_COLOR_TOKENS.has(token[1])) throw new Error(`${property} 必须使用批准颜色 token`)
  }
  const withoutTokens = value.replace(/var\(--[\w-]+\)/g, '')
  if (/\b[a-z-]+\s*\(/i.test(withoutTokens)) throw new Error(`${property} 不得使用颜色函数`)
  const withoutBorderSyntax = withoutTokens
    .replace(/\b(?:solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)\b/gi, '')
    .replace(/[-+]?(?:\d*\.)?\d+(?:[a-z%]+)?/gi, '')
  if (/[a-z]/i.test(withoutBorderSyntax)) throw new Error(`${property} 颜色必须来自批准 token`)
}

function validateRiskStyles(css: string): void {
  const riskRules = riskRuleBlocks(css)
  const riskCss = riskRules.join('\n')
  for (const token of riskCss.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!APPROVED_RISK_TOKENS.has(token[1])) throw new Error(`风控区使用未批准 token：${token[1]}`)
  }
  for (const token of REQUIRED_RISK_TOKENS) {
    if (!riskCss.includes(`var(${token})`)) throw new Error(`缺少设计角色 ${token}`)
  }
  for (const rule of riskRules) {
    if (rule.includes('.wr-metric-grid')) throw new Error('风控区不得继续使用指标网格')
    for (const { property, value } of declarations(rule)) {
      if (['box-shadow', 'text-shadow', 'filter', '-webkit-filter'].includes(property)) {
        throw new Error('风控区不得使用阴影或滤镜')
      }
      if (property === 'background-image' || property.startsWith('border-image')) {
        throw new Error('风控区不得使用私有图像颜色入口')
      }
      if (property === 'font') throw new Error('风控区不得使用 font 简写')
      if (property === 'font-family' && !/^var\(\s*--font-ui\s*\)$/.test(value)) {
        throw new Error('风控区字体族必须使用 --font-ui')
      }
      if (TOKEN_ONLY_PROPERTIES.has(property) && !/^var\(--[\w-]+\)$/.test(value)) {
        throw new Error(`${property} 必须直接消费 token`)
      }
      assertRiskColorUsesApprovedTokens(property, value)
    }
  }
}

function expectRiskContractFailure(css: string, message: string): void {
  try {
    validateRiskStyles(css)
  } catch {
    return
  }
  throw new Error(message)
}

export function testWeeklyRiskStylesUseOnlyApprovedDesignRoles(): void {
  const css = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8').replace(/\r\n?/g, '\n')
  validateRiskStyles(css)
}

export function testWeeklyRiskStyleContractRejectsTokenAndVisualBypasses(): void {
  const approvedRoles = `
    .wr-risk-period {
      background: var(--bg-elevated);
      color: var(--text-strong);
      border: 1px solid var(--border-subtle);
      font-family: var(--font-ui);
      font-variant-numeric: var(--numeric-tabular);
      font-feature-settings: "tnum" 1, "kern" 1;
    }
    .wr-risk-period.is-primary { background: var(--bg-inset); }
    .wr-risk-period small { color: var(--text-muted); }
  `
  const readableTokenFixture = `${approvedRoles}
    .wr-risk-readable { font-size: var(--type-body-size); gap: var(--sp-3); }
  `

  validateRiskStyles(readableTokenFixture)

  for (const [name, declaration] of [
    ['未批准 token', 'color: var(--unapproved);'],
    ['带 fallback 的未批准 token', 'width: var(--unapproved, 0px);'],
    ['padding-block 裸值', 'padding-block: 12px;'],
    ['大小写 padding-block 裸值', 'Padding-block: 12px;'],
    ['margin-block 裸值', 'margin-block: 12px;'],
    ['padding-inline 裸值', 'padding-inline: 12px;'],
    ['margin-inline 裸值', 'margin-inline: 12px;'],
    ['row-gap 裸值', 'row-gap: 12px;'],
    ['column-gap 裸值', 'column-gap: 12px;'],
    ['font 简写', 'font: 12px serif;'],
    ['大小写 font 简写', 'FONT: 12px serif;'],
    ['大小写 box-shadow', 'BOX-SHADOW: 0 0 1px var(--accent);'],
    ['background-image 渐变', 'background-image: linear-gradient(#fff, #000);'],
    ['text-shadow 命名颜色', 'text-shadow: 0 0 1px red;'],
    ['drop-shadow 滤镜', 'filter: drop-shadow(0 0 1px red);'],
    ['border-image 简写', 'border-image: linear-gradient(red, blue) 1;'],
    ['border-image-source', 'border-image-source: linear-gradient(red, blue);'],
    ['私有字体族', 'font-family: serif;'],
    ['color-mix 颜色函数', 'color: color-mix(in srgb, var(--pos), var(--neg));'],
    ['大小写 color 命名颜色', 'COLOR: red;'],
    ['大小写 background 颜色函数', 'BACKGROUND: color-mix(in srgb, var(--pos), var(--neg));'],
    ['currentColor', 'color: currentColor;'],
    ['命名颜色', 'color: red;'],
    ['十六进制颜色', 'color: #123456;'],
    ['非颜色 token', 'color: var(--sp-3);'],
    ['其他颜色函数', 'color: light-dark(var(--pos), var(--neg));'],
    ['fill 命名颜色', 'fill: red;'],
    ['stroke currentColor', 'stroke: currentColor;'],
  ]) {
    expectRiskContractFailure(`${approvedRoles}.wr-risk-bypass { ${declaration} }`, `合同未拒绝${name}`)
  }
  expectRiskContractFailure(
    `${approvedRoles}.wr-risk-period .wr-metric-grid { display: grid; }`,
    '合同未拒绝风控指标网格',
  )

  const css = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8').replace(/\r\n?/g, '\n')
  if (/(?:font-size|gap|padding|margin|border-radius):var\(--/.test(riskRuleBlocks(css).join('\n'))) {
    throw new Error('风控 token 声明必须保留冒号后的可读空格')
  }
}

export function testWeeklyRiskStyleContractCannotBeBypassedWithComments(): void {
  const approvedRoles = `
    .wr-risk-period {
      background: var(--bg-elevated);
      color: var(--text-strong);
      border: 1px solid var(--border-subtle);
      font-family: var(--font-ui);
      font-variant-numeric: var(--numeric-tabular);
      font-feature-settings: "tnum" 1, "kern" 1;
    }
    .wr-risk-period.is-primary { background: var(--bg-inset); }
    .wr-risk-period small { color: var(--text-muted); }
  `

  for (const [name, rule] of [
    ['声明前单行注释', '.wr-risk-comment { /* 说明 */ background-image: linear-gradient(#fff, #000); }'],
    ['声明前多行注释', `.wr-risk-comment {
      /* 多行
         说明 */
      text-shadow: 0 0 1px red;
    }`],
    ['含结构字符的注释', '.wr-risk-comment { /* ; { } */ font-family: serif; }'],
  ]) {
    expectRiskContractFailure(`${approvedRoles}${rule}`, `CSS 注释绕过了${name}门禁`)
  }

  validateRiskStyles(`${approvedRoles}
    .wr-risk-comment {
      /* 合法说明；可以换行 */
      color: var(--text-strong);
      font-family: var(--font-ui);
    }
  `)
}

export function testWeeklyRiskStylesTargetTheEvidenceDom(): void {
  const css = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8').replace(/\r\n?/g, '\n')
  const riskCss = riskRuleBlocks(css)
  const dailyValueRule = riskCss.find((block) => block.includes('.wr-risk-day strong')) ?? ''
  const auditContentRule = riskCss.find(
    (block) => block.includes('.wr-risk-audit p') && block.includes('.wr-risk-audit article'),
  ) ?? ''

  for (const declaration of [
    'font-family: var(--font-ui)',
    'font-variant-numeric: var(--numeric-tabular)',
    'font-feature-settings: "tnum" 1, "kern" 1',
  ]) {
    if (!dailyValueRule.includes(declaration)) {
      throw new Error(`每日风险的实际 strong 元素必须使用 UI 等宽数字样式：${declaration}`)
    }
  }
  for (const declaration of [
    'padding-block-end: var(--sp-3)',
    'color: var(--text-muted)',
    'font-size: var(--type-metadata-size)',
  ]) {
    if (!auditContentRule.includes(declaration)) {
      throw new Error(`审计实际内容必须保留详情样式：${declaration}`)
    }
  }
}

export function testWeeklyReviewNarrativeLimitsElevatedSectionRoles(): void {
  const css = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8').replace(/\r\n?/g, '\n')
  const sectionRule = css.match(/\.wr-section\s*\{[^}]+\}/s)?.[0] ?? ''
  const pairedExceptionRule = css.match(/\.wr-previous,\.wr-commitment\s*\{[^}]+\}/s)?.[0] ?? ''
  const riskExceptionRule = css.match(/\.wr-risk-evidence\s*\{[^}]+\}/s)?.[0] ?? ''

  if (!sectionRule.includes('border: 0') || !sectionRule.includes('background: transparent')) {
    throw new Error('周复盘普通章节必须使用连续分隔叙事，而不是等权卡片')
  }
  if (!pairedExceptionRule.includes('background: var(--bg-elevated)') || !riskExceptionRule.includes('background: var(--bg-elevated)')) {
    throw new Error('只有风控、上次承诺和下周承诺可以保留抬升容器')
  }
}

import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(file: string): string {
  return readFileSync(path.resolve(file), 'utf8').replace(/\r\n?/g, '\n')
}

export function testRiskStatusStripUsesProjectTokensAndNoConfigurationCopy(): void {
  const source = read('src/components/RiskStatusStrip.tsx')
  const css = read('src/components/RiskStatusStrip.css')
  for (const forbidden of ['修改规则', '1R =', '单笔风险比例', '确认本周规则']) {
    if (source.includes(forbidden)) throw new Error(`risk strip must stay read-only: ${forbidden}`)
  }
  if (/#[0-9a-f]{3,8}\b/i.test(css)) throw new Error('risk strip must not hard-code colors')
  for (const token of ['var(--border-subtle)', 'var(--pos)', 'var(--warn-action)', 'var(--neg)']) {
    if (!css.includes(token)) throw new Error(`risk strip must use ${token}`)
  }
}

export function testRiskStatusStripStacksWithoutHorizontalScrolling(): void {
  const css = read('src/components/RiskStatusStrip.css')
  const mobile = css.slice(css.indexOf('@media (max-width: 899px)'))
  if (!mobile.includes('grid-template-columns: 1fr')) throw new Error('risk periods must stack below 899px')
  if (mobile.includes('overflow-x: auto')) throw new Error('risk periods must not require horizontal scrolling')
}

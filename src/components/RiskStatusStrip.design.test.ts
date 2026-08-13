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
  for (const forbidden of ['font-family: Inter', 'linear-gradient', 'radial-gradient', 'box-shadow: 0 0']) {
    if (css.includes(forbidden)) throw new Error(`risk strip must follow the existing design system: ${forbidden}`)
  }
  if (/\.risk-status-period\.is-normal[^}]*background:/s.test(css)) {
    throw new Error('normal periods must not add a colored surface')
  }
  for (const token of ['var(--border-subtle)', 'var(--pos)', 'var(--warn-action)', 'var(--neg)']) {
    if (!css.includes(token)) throw new Error(`risk strip must use ${token}`)
  }

  const recoveryLinks = source.match(/<Link\b[^>]*\bto="\/settings\/risk"/g) ?? []
  if (recoveryLinks.length !== 1) {
    throw new Error('attention and unreviewed states must expose one recovery link to /settings/risk')
  }
  if (!source.includes('!reviewed') || !source.includes("row.presentation.kind === 'unknown'")) {
    throw new Error('unreviewed and attention states must retain the risk-management recovery path')
  }
  if (!source.includes("label: '待复核'") || !source.includes("detail: '本周规则未确认'")) {
    throw new Error('unreviewed weeks must present the weekly attention state instead of normal')
  }
  if (!css.includes('.risk-status-period.is-unreviewed')) {
    throw new Error('unreviewed weeks must reuse the risk strip attention visual')
  }
}

export function testRiskStatusStripKeepsDesktopGridWithoutPhoneBranches(): void {
  const css = read('src/components/RiskStatusStrip.css')
  if (!css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))')) {
    throw new Error('risk periods must retain the dense three-column desktop grid')
  }
  if (/@media[^\{]*max-width:\s*(?:[1-8]\d\d|899)px/.test(css)) {
    throw new Error('risk strip must not maintain unsupported phone-width branches')
  }
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8').replace(/\r\n?/g, '\n')
}

function declaration(source: string, selector: string, property: string): string | undefined {
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]?.split(',').map((candidate) => candidate.trim()) ?? []
    if (!selectors.includes(selector)) continue
    return match[2]?.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;\\n]+)`))?.[1]?.trim()
  }
  return undefined
}

export function testRiskRepairPrimaryActionUsesReadableTokenPairs(): void {
  const css = read('src/components/ui/Button.css')
  const view = read('src/views/settings/RiskDataRepairView.tsx')
  assert.match(view, /className="ui-btn ui-btn-primary ui-btn-sm risk-repair-action"/)

  assert.equal(declaration(css, '.ui-btn-primary', 'background'), 'var(--accent)')
  assert.equal(
    declaration(css, '.ui-btn-primary', 'color'),
    'var(--accent-text)',
    '修复中心主动作必须在 accent 背景上使用 accent-text 前景',
  )
  assert.equal(declaration(css, '.ui-btn-primary:hover:not(:disabled)', 'background'), 'var(--accent-hover)')
  assert.equal(
    declaration(css, '.ui-btn-primary:hover:not(:disabled)', 'color'),
    'var(--accent-text)',
    '修复中心主动作悬停态必须在 accent-hover 背景上继续使用 accent-text 前景',
  )
}

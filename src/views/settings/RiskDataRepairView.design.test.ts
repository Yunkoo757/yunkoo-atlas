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
  const css = read('src/views/settings/RiskDataRepairView.css')

  assert.equal(declaration(css, '.risk-repair-next', 'background'), 'var(--accent)')
  assert.equal(
    declaration(css, '.risk-repair-next', 'color'),
    'var(--accent-text)',
    '修复中心主动作必须在 accent 背景上使用 accent-text 前景',
  )
  assert.equal(declaration(css, '.risk-repair-next:hover', 'background'), 'var(--accent-hover)')
  assert.equal(
    declaration(css, '.risk-repair-next:hover', 'color'),
    'var(--accent-text)',
    '修复中心主动作悬停态必须在 accent-hover 背景上继续使用 accent-text 前景',
  )
}

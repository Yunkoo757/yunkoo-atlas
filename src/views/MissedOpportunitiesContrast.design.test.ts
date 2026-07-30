import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8').replace(/\r\n?/g, '\n')
}

function rule(source: string, selector: string): string {
  return source.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))?.[1] ?? ''
}

export function testMissedOpportunityControlsKeepTheVerifiedThreeToOneBoundary(): void {
  const source = read('src/views/MissedOpportunitiesView.css')
  const boundaryMix = source.match(
    /--missed-control-boundary:\s*color-mix\(in srgb, var\(--text-tertiary\) (\d+)%, var\(--bg-surface\)\)/,
  )

  if (!boundaryMix || Number(boundaryMix[1]) < 66) {
    throw new Error('错过机会控件边界必须保留真实渲染已验证的至少 3:1 中性对比度')
  }

  for (const selector of [
    '\\.missed-scope-trigger',
    '\\.missed-view > \\.ui-filter-shell \\.ui-filter-trigger',
    '\\.missed-scope-check',
  ]) {
    if (!rule(source, selector).includes('var(--missed-control-boundary)')) {
      throw new Error(`${selector} 必须消费已验证的错过机会控件边界 token`)
    }
  }
}

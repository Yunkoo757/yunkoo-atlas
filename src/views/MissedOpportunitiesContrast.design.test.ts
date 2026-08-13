import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8').replace(/\r\n?/g, '\n')
}

function ruleBlock(source: string, start: number): string {
  const open = source.indexOf('{', start)
  if (open < 0) throw new Error('CSS 规则缺少起始花括号')
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  throw new Error('CSS 规则缺少结束花括号')
}

function mediaBlock(source: string, query: string): string | null {
  const start = source.indexOf(query)
  return start < 0 ? null : ruleBlock(source, start)
}

export function testMissedOpportunityActionsUseTheSharedToolbarControl(): void {
  const scopeMenu = read('src/components/trades/MissedOpportunityScopeMenu.tsx')
  const viewStyles = read('src/views/MissedOpportunitiesView.css')
  const tokens = read('src/styles/tokens.css')

  if (!scopeMenu.includes("className={'ui-filter-trigger missed-scope-trigger'")) {
    throw new Error('范围按钮必须直接复用共享工具栏控件样式')
  }
  if (viewStyles.includes('--missed-control-boundary')) {
    throw new Error('范围与筛选按钮不得恢复页面私有的高亮描边')
  }
  if (!tokens.includes('--toolbar-action-height: var(--field-height-md);')) {
    throw new Error('工具栏动作高度必须复用共享 field-height-md token')
  }
  if (/@media[^\{]*max-width:\s*(?:[1-8]\d\d|899)px/.test(viewStyles)) {
    throw new Error('错过机会页不得维护不受支持的手机宽度分支')
  }
}

import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8').replace(/\r\n?/g, '\n')
}

export function testMissedOpportunityActionsUseTheSharedToolbarControl(): void {
  const scopeMenu = read('src/components/trades/MissedOpportunityScopeMenu.tsx')
  const viewStyles = read('src/views/MissedOpportunitiesView.css')

  if (!scopeMenu.includes("className={'ui-filter-trigger missed-scope-trigger'")) {
    throw new Error('范围按钮必须直接复用共享工具栏控件样式')
  }
  if (viewStyles.includes('--missed-control-boundary')) {
    throw new Error('范围与筛选按钮不得恢复页面私有的高亮描边')
  }
}

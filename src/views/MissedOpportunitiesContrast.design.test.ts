import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8').replace(/\r\n?/g, '\n')
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
  const mobileActionPillUsesSharedHeight = /@media \(max-width: 768px\) \{[\s\S]*?\.missed-scope-trigger::before,\s*\n\s*\.missed-view > \.ui-filter-shell \.ui-filter-trigger::before,\s*\n\s*\.missed-view > \.ui-filter-shell \.ui-filter-chip:not\(\.ui-filter-chip-static\)::before\s*\{[\s\S]*?height:\s*var\(--toolbar-action-height\);/.test(viewStyles)
  if (!mobileActionPillUsesSharedHeight) {
    throw new Error('移动端范围与筛选按钮的胶囊层必须保留共享高度 token')
  }
}

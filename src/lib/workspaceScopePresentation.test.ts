import { presentWorkspaceScope } from '@/lib/workspaceScopePresentation'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testWorkspaceScopePresentationKeepsPageAndScopeSeparate(): void {
  const scope = presentWorkspaceScope({ type: 'starred', tradeKind: 'live' })
  assert(scope.summary === '星标交易', '范围摘要必须独立解释当前范围')
  assert(scope.clearIntent === 'scope-and-advanced', '内置范围必须允许回到默认页面')
}

export function testAdvancedFiltersOnlyClearTheirOwnIncrement(): void {
  const scope = presentWorkspaceScope(
    { type: 'all', tradeKind: 'live' },
    { hasAdvancedFilters: true },
  )
  assert(scope.summary === undefined, '默认页面不得伪造范围标题')
  assert(scope.clearIntent === 'advanced-only', '高级筛选只能清除自身增量')
}

export function testWorkspaceScopePresentationUsesCanonicalMissedOpportunityTerm(): void {
  const scope = presentWorkspaceScope({ type: 'missed', tradeKind: 'live' })
  assert(scope.summary === '错过机会', '错过视图不得另造“未执行机会”同义词')
}

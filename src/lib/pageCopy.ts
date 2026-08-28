import type { ListFilter } from '@/lib/tradeFilters'
import type { BusinessDateAnchor } from '@/lib/periods'
import { presentWorkspaceScope } from '@/lib/workspaceScopePresentation'

export const MISSED_PAGE_TITLE = '错过的机会'

export function getTradesPageSubtitle(
  filter: ListFilter,
  businessDateAnchor?: BusinessDateAnchor,
): string | undefined {
  return presentWorkspaceScope(filter, { businessDateAnchor }).summary
}

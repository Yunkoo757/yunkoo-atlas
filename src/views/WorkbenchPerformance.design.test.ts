import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8').replace(/\r\n?/g, '\n')
}

export function testWorkbenchDerivationReusesTheActiveTradeCollection(): void {
  const source = read('src/hooks/useWorkbenchVisibleTrades.ts')

  if (!source.includes('const trades = useMemo(')) {
    throw new Error('workbench hook must memoize the active trade collection')
  }
  if (source.includes('getWorkbenchVisibleTrades')) {
    throw new Error('workbench hook must not filter deleted trades a second time')
  }
}

export function testSelectionIdentityOnlyScansWhenVisibleRowsChange(): void {
  for (const file of ['src/views/ListView.tsx', 'src/views/TableView.tsx']) {
    const source = read(file)
    if (!source.includes("const visibleIdsKey = useMemo(\n    () => visible.map((trade) => trade.id).join('\\u0000'),\n    [visible],\n  )")) {
      throw new Error(`${path.basename(file)} must memoize its visible row identity`)
    }
  }
}

export function testTodayWorkspaceUsesConstantTimeStarredLookup(): void {
  const source = read('src/views/TodayWorkspace.tsx')

  if (!source.includes('const starredIdSet = useMemo(() => new Set(starredIds), [starredIds])')) {
    throw new Error('today workspace must build one starred ID set per starred collection')
  }
  if (source.includes('starred={starredIds.includes(trade.id)}')) {
    throw new Error('today rows must not linearly scan starred IDs')
  }
}

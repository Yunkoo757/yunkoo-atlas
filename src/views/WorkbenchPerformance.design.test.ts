import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function normalizeSourceText(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

function read(relativePath: string): string {
  return normalizeSourceText(readFileSync(path.resolve(relativePath), 'utf8'))
}

export function testSourceContractsNormalizeWindowsLineEndings(): void {
  if (normalizeSourceText('first\r\nsecond\rthird') !== 'first\nsecond\nthird') {
    throw new Error('source-contract tests must compare normalized line endings')
  }
}

export function testWorkbenchDerivationReusesTheActiveTradeCollection(): void {
  const source = read('src/hooks/useWorkbenchVisibleTrades.ts')

  if (!source.includes('const derived = useMemo(')) {
    throw new Error('workbench hook must memoize the active and visible trade derivation')
  }
  if (!source.includes('deriveWorkbenchVisibleTrades({')) {
    throw new Error('workbench hook must reuse the shared visible-trade derivation')
  }
  if (source.includes('filterTradesByFacets(applyDisplayPrefs')) {
    throw new Error('workbench hook must not maintain a second filtering pipeline')
  }
}

export function testSelectionIdentityOnlyScansWhenVisibleRowsChange(): void {
  for (const file of ['src/views/ListView.tsx']) {
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

export function testRemovedTableViewHasNoRuntimeSurface(): void {
  for (const file of ['src/views/TableView.tsx', 'src/views/TableView.css', 'src/lib/tradeTable.ts']) {
    if (existsSync(path.resolve(file))) {
      throw new Error(`${file} must remain deleted with the retired table view`)
    }
  }
  const topbar = read('src/components/Topbar.tsx')
  const actions = read('src/shortcuts/actions.ts')
  const app = read('src/App.tsx')
  if (topbar.includes('view.table') || actions.includes('view.table') || app.includes('TableView')) {
    throw new Error('retired table view must not retain a UI, shortcut, or renderer entry point')
  }
}

export function testLinearCalibratedListGeometryAndSurfacesStayCanonical(): void {
  const tokens = read('src/styles/tokens.css')
  const list = read('src/components/trades/TradeList.css')
  const listRuntime = read('src/components/trades/TradeList.tsx')
  const quickViews = read('src/components/trades/QuickViewBar.css')
  const sidebar = read('src/components/Sidebar.css')
  const filterBar = read('src/components/ui/FilterBar.css')

  for (const contract of [
    '--trade-group-height: 36px',
    '--trade-row-height: 44px',
    '--toolbar-chip-height: 28px',
    '--surface-row-selected: lch(10.691% 0.493 272 / 1)',
    '--surface-group: lch(7.67% 0.75 272 / 1)',
    '--group-chevron-started: lch(18.47% 7 78)',
    '--group-chevron-done: lch(18.47% 7 283)',
  ]) {
    if (!tokens.includes(contract)) throw new Error(`missing calibrated token: ${contract}`)
  }
  if (!list.includes('--trade-group-chevron')) {
    throw new Error('group headers must tint CollapseArrow by status/recency, not repaint the bar')
  }
  if (!listRuntime.includes('const HEADER_HEIGHT = 36')) {
    throw new Error('virtual group header estimate must match the 36px visual header')
  }
  if (list.includes('box-shadow: inset 2px 0 0 var(--accent)')) {
    throw new Error('selected rows must not retain the old blue leading rail')
  }
  if (!list.includes('font-feature-settings: "calt" 1, "cpsp" 1, "tnum" 1')) {
    throw new Error('trade references must preserve the calibrated Inter OpenType features')
  }
  if (!quickViews.includes('.quick-view-chip::after') || !quickViews.includes('box-shadow: var(--surface-control-shadow-active)')) {
    throw new Error('quick-view pills must retain the calibrated ::after contract layer')
  }
  if (!quickViews.includes('border: 1px solid var(--surface-control-border)')) {
    throw new Error('quick-view pills must paint the 1px ring with inset border, not outward box-shadow')
  }
  if (quickViews.includes('box-shadow: var(--surface-control-shadow);')) {
    throw new Error('quick-view pills must not use outward surface-control-shadow rings that clip under overflow')
  }
  if (!list.includes('inset: 2px 8px') || !list.includes('padding: 0 10px')) {
    throw new Error('trade rows must preserve symmetric 2px vertical breathing room and content padding')
  }
  if (!filterBar.includes('padding: 0 15px 0 8px')) {
    throw new Error('filter toolbar must share the calibrated 8px leading inset')
  }
  if (!filterBar.includes('border: 1px solid var(--surface-control-border)')) {
    throw new Error('filter chips must paint the 1px ring with inset border, not outward box-shadow')
  }
  if (filterBar.includes('box-shadow: var(--surface-control-shadow)')) {
    throw new Error('filter chips must not use outward surface-control-shadow rings that clip under overflow')
  }
  if (!filterBar.includes('padding-block:') || !filterBar.includes('overflow-x: auto')) {
    throw new Error('active filter strip must keep horizontal scroll with vertical padding so rings are not clipped')
  }
  if (!quickViews.includes('border: 0')) {
    throw new Error('quick-view strip must not offset calibrated tabs with a transparent parent border')
  }
  if (!sidebar.includes('height: 28px') || !sidebar.includes('border-radius: var(--radius-8)')) {
    throw new Error('sidebar navigation must preserve the calibrated 28px / 8px geometry')
  }
}

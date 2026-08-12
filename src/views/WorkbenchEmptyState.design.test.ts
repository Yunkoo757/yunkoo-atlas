import { readFileSync } from 'node:fs'
import path from 'node:path'

const WORKBENCH_VIEWS = ['ListView.tsx', 'BoardView.tsx'] as const

export function testAllWorkbenchLayoutsShareRecoverableEmptyStates(): void {
  for (const file of WORKBENCH_VIEWS) {
    const source = readFileSync(path.resolve('src/views', file), 'utf8')
    if (!source.includes('<WorkbenchEmptyState')) {
      throw new Error(`${file} must use the shared workbench empty state`)
    }
    if (!source.includes('onReset={resetEmptyConditions}')) {
      throw new Error(`${file} must expose the recovery action when records are filtered out`)
    }
    if (!source.includes('shouldResetWorkbenchHideClosed({')) {
      throw new Error(`${file} must not clear hideClosed unless it affects the current workspace`)
    }
  }
}

export function testEmptyLibraryKeepsOnePrimaryAndOrderedSecondaryActions(): void {
  const source = readFileSync(
    path.resolve('src/components/trades/WorkbenchEmptyState.tsx'),
    'utf8',
  )
  if (!source.includes('<span>{primary.label}</span>')) {
    throw new Error('The empty library primary action must name the current record kind')
  }
  if (!source.includes('state.secondaryActions.map((action)')) {
    throw new Error('Secondary first-use actions must follow the model order')
  }
  if (!source.includes('className="workbench-empty-secondary"')) {
    throw new Error('Secondary actions must use a quieter visual role than the primary action')
  }
}

export function testBoardEmptyStateWinsOverShowingEmptyColumns(): void {
  const source = readFileSync(path.resolve('src/views/BoardView.tsx'), 'utf8')
  if (!source.includes('{emptyState ? (')) {
    throw new Error('Board empty-state rendering must not depend on the show-empty-groups preference')
  }
}

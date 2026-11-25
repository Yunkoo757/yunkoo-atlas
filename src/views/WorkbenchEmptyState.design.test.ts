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
    if (!source.includes('useWorkbenchEmptyState(filter, workspace, journal)')) {
      throw new Error(`${file} must share its recovery logic with the other layout`)
    }
  }
  const recovery = readFileSync(path.resolve('src/hooks/useWorkbenchEmptyState.ts'), 'utf8')
  if (!recovery.includes('shouldResetWorkbenchHideClosed({') || !recovery.includes('getJournalFilterResetSearch(')) {
    throw new Error('Recovery must distinguish hidden closed trades from temporary filters')
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
  if (!source.includes('className="ui-btn ui-btn-ghost ui-btn-md"')) {
    throw new Error('Secondary actions must use a quieter visual role than the primary action')
  }
}

export function testBoardEmptyStateWinsOverShowingEmptyColumns(): void {
  const source = readFileSync(path.resolve('src/views/BoardView.tsx'), 'utf8')
  if (!source.includes('{emptyState ? (')) {
    throw new Error('Board empty-state rendering must not depend on the show-empty-groups preference')
  }
}

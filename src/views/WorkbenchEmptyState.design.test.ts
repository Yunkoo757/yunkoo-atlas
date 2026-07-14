import { readFileSync } from 'node:fs'
import path from 'node:path'

const WORKBENCH_VIEWS = ['ListView.tsx', 'TableView.tsx', 'BoardView.tsx'] as const

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

export function testBoardEmptyStateWinsOverShowingEmptyColumns(): void {
  const source = readFileSync(path.resolve('src/views/BoardView.tsx'), 'utf8')
  if (!source.includes('{emptyState ? (')) {
    throw new Error('Board empty-state rendering must not depend on the show-empty-groups preference')
  }
}

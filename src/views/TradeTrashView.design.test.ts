import { readFileSync } from 'node:fs'
import path from 'node:path'

export function testTrashSelectAllDoesNotNestButtons() {
  const source = readFileSync(path.resolve('src/views/TradeTrashView.tsx'), 'utf8')
  const controlStart = source.indexOf('<div className="trash-select-all-btn">')
  const controlEnd = source.indexOf('</div>', controlStart)

  if (controlStart < 0 || controlEnd < 0) {
    throw new Error('Trash select-all control group was not found')
  }

  const control = source.slice(controlStart, controlEnd)
  if (!control.includes('<SelectionBox') || !control.includes('trash-select-all-label')) {
    throw new Error('Trash select-all must keep separate checkbox and label controls')
  }
}

export function testTrashSearchRemainsAvailableWhenNoRowsMatch() {
  const source = readFileSync(path.resolve('src/views/TradeTrashView.tsx'), 'utf8')

  if (!source.includes("trashTrades.length === 0")) {
    throw new Error('Trash empty state must depend on the underlying trash, not filtered results')
  }
  if (!source.includes("filteredTrades.length === 0 ? (")) {
    throw new Error('Filtered empty state must render inside the persistent trash toolbar')
  }
}

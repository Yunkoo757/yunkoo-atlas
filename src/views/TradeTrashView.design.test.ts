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

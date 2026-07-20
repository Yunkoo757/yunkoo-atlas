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

export function testTrashContextMenuUsesTheSharedActionHierarchy() {
  const source = readFileSync(path.resolve('src/views/TradeTrashView.tsx'), 'utf8')

  if (!source.includes("text: '回收站操作'")) {
    throw new Error('Trash context menu heading must describe its action group')
  }
  if (!source.includes("label: '恢复记录'")) {
    throw new Error('Trash restore action must use the same explicit verb-object pattern')
  }
  if (source.includes("text: `${trade.ref} ·")) {
    throw new Error('Trash context menu must not misuse an action heading as record metadata')
  }
}

export function testTrashIsAnIndependentTopLevelPage() {
  const source = readFileSync(path.resolve('src/views/TradeTrashView.tsx'), 'utf8')

  if (source.includes("{ label: '交易日志' }")) {
    throw new Error('回收站不得再挂在「交易日志」面包屑下')
  }
  if (!source.includes("crumbs={[{ label: '回收站', active: true }]}")) {
    throw new Error('回收站应作为独立页标题展示')
  }
  if (source.includes('backLabel="返回交易日志"')) {
    throw new Error('回收站返回动作不得暗示隶属交易日志')
  }
}

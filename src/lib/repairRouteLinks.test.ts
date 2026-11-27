import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testWorkbenchRepairLinksPointToExistingRoutes(): Promise<void> {
  const [list, dashboard, weekly, board, header] = await Promise.all([
    readFile('src/views/ListView.tsx', 'utf8'),
    readFile('src/views/Dashboard.tsx', 'utf8'),
    readFile('src/views/WeeklyReviewView.tsx', 'utf8'),
    readFile('src/views/BoardView.tsx', 'utf8'),
    readFile('src/components/trades/TradeWorkbenchHeader.tsx', 'utf8'),
  ])
  assert(list.includes('<TradeWorkbenchHeader') && board.includes('<TradeWorkbenchHeader'), '列表与看板应提供相同的核对入口')
  assert(header.includes("navigate('/settings/data/stage-ownership-repair',") && header.includes('ownershipOrigin:'), '待归属必须进入阶段归属修复页')
  assert(!header.includes('to="/settings/data-health"'), '列表不得继续指向不存在的 data-health')
  assert(dashboard.includes('data-close-day-repair'), '待补平仓日期必须打开缺日期的交易详情')
  assert(!dashboard.includes('to="/import-data-health"'), '待补平仓日期不得再进入导入数据健康页')
  assert(!dashboard.includes('to="/settings/data-health"'), '统计页不得继续指向不存在的 data-health')
  assert(weekly.includes('data-weekly-result-link'), '周复盘待补/冲突结果必须提供跳转')
  assert.match(header, /<ResultConflictRepair\b[^>]*\bids=\{resultRepairIds\}/, '核对入口必须使用当前范围内待处理的记录')
}

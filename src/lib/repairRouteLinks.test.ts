import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testWorkbenchRepairLinksPointToExistingRoutes(): Promise<void> {
  const [list, dashboard, weekly, board] = await Promise.all([
    readFile('src/views/ListView.tsx', 'utf8'),
    readFile('src/views/Dashboard.tsx', 'utf8'),
    readFile('src/views/WeeklyReviewView.tsx', 'utf8'),
    readFile('src/views/BoardView.tsx', 'utf8'),
  ])
  assert(list.includes('to="/settings/data/stage-ownership-repair"'), '待归属必须进入阶段归属修复页')
  assert(!list.includes('to="/settings/data-health"'), '列表不得继续指向不存在的 data-health')
  assert(dashboard.includes('data-close-day-repair'), '待补平仓日期必须打开缺日期的交易详情')
  assert(!dashboard.includes('to="/import-data-health"'), '待补平仓日期不得再进入导入数据健康页')
  assert(!dashboard.includes('to="/settings/data-health"'), '统计页不得继续指向不存在的 data-health')
  assert(weekly.includes('data-weekly-result-link'), '周复盘待补/冲突结果必须提供跳转')
  assert(board.includes('data-workbench-result-repair'), '看板必须挂上结果修复条')
}

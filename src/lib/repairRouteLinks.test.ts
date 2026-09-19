import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testWorkbenchRepairLinksPointToExistingRoutes(): Promise<void> {
  const [list, dashboard] = await Promise.all([
    readFile('src/views/ListView.tsx', 'utf8'),
    readFile('src/views/Dashboard.tsx', 'utf8'),
  ])
  assert(list.includes('to="/settings/data/stage-ownership-repair"'), '待归属必须进入阶段归属修复页')
  assert(!list.includes('to="/settings/data-health"'), '列表不得继续指向不存在的 data-health')
  assert(dashboard.includes('to="/import-data-health"'), '待补平仓日期必须进入导入数据健康页')
  assert(!dashboard.includes('to="/settings/data-health"'), '统计页不得继续指向不存在的 data-health')
}

import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(file: string): string {
  return readFileSync(path.resolve(file), 'utf8').replace(/\r\n?/g, '\n')
}

export function testLowRiskDesktopActionsReuseSharedControls(): void {
  const empty = read('src/components/trades/WorkbenchEmptyState.tsx')
  const today = read('src/views/TodayWorkspace.tsx')
  const weekly = read('src/views/WeeklyReviewView.tsx')

  if (!empty.includes("import { Button } from '@/components/ui/Button'")) {
    throw new Error('工作台空状态主操作必须复用 Button')
  }
  if (!/<Button[\s\S]*?variant="primary"[\s\S]*?workbench-empty-primary/.test(empty)) {
    throw new Error('工作台空状态主操作必须保留 primary 语义')
  }
  if (!today.includes("import { Button } from '@/components/ui/Button'")) {
    throw new Error('今日工作台新建交易必须复用 Button')
  }
  if (!today.includes("variant={buckets.actionCount > 0 ? 'bordered' : 'primary'}")) {
    throw new Error('今日工作台新建交易必须根据行动队列保持既有强调层级')
  }
  if (!weekly.includes("import { IconButton } from '@/components/ui/IconButton'")) {
    throw new Error('周复盘前后导航必须复用 IconButton')
  }
  for (const label of ['上一条复盘', '下一条复盘']) {
    if (!weekly.includes(`<IconButton label="${label}"`)) {
      throw new Error(`周复盘缺少共享图标按钮：${label}`)
    }
  }
}

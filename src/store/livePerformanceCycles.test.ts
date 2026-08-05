import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const first: LivePerformanceCycle = {
  id: 'cycle-store-first',
  name: '首个周期',
  startTradingDayKey: '2026-08-01',
  createdAt: '2026-08-01T00:00:00.000Z',
}

export function testLivePerformanceCycleStoreActionsDoNotModifyTradesOrReviews(): void {
  const previous = useStore.getState()
  const beforeTrades = JSON.stringify(previous.trades)
  const beforeReviews = JSON.stringify(previous.weeklyReviews)
  try {
    useStore.setState({
      livePerformanceCycles: [],
      liveStatsStartTradingDayKey: '2026-07-01',
    })

    useStore.getState().createLivePerformanceCycle(first, '2026-08-05')
    assert(useStore.getState().livePerformanceCycles[0]?.id === first.id, '创建必须写入第一个周期')

    useStore.getState().renameLivePerformanceCycle(first.id, '新名称')
    assert(useStore.getState().livePerformanceCycles[0]?.name === '新名称', '重命名必须更新周期名称')

    useStore.getState().undoLatestLivePerformanceCycle()
    assert(useStore.getState().livePerformanceCycles.length === 0, '撤销必须移除最新周期')
    assert(JSON.stringify(useStore.getState().trades) === beforeTrades, '周期操作不得修改交易')
    assert(JSON.stringify(useStore.getState().weeklyReviews) === beforeReviews, '周期操作不得修改周复盘')
    assert(useStore.getState().liveStatsStartTradingDayKey === '2026-07-01', '周期操作不得修改风险起点')
  } finally {
    useStore.setState(previous)
  }
}

export function testReplaceLivePerformanceCyclesValidatesAndClonesInput(): void {
  const previous = useStore.getState()
  try {
    const cycles = [{ ...first }]
    useStore.getState().replaceLivePerformanceCycles(cycles)
    cycles[0]!.name = '外部变更'
    assert(useStore.getState().livePerformanceCycles[0]?.name === first.name, '替换必须克隆输入周期')
  } finally {
    useStore.setState(previous)
  }
}

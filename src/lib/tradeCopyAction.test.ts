import type { Trade } from '@/data/trades'
import { copyTradeRecord } from '@/lib/tradeCopyAction'
import { useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const source: Trade = {
  id: 'shared-copy-source',
  ref: 'TRD-20',
  symbol: 'EURUSD',
  side: 'long',
  status: 'loss',
  conviction: 'medium',
  strategyId: 'uncategorized',
  timeframe: '4H',
  tags: ['导航1'],
  mistakeTags: ['恐惧'],
  reviewStatus: 'reviewed',
  reviewedAt: '2026-08-15T08:00:00.000Z',
  reviewCategory: 'mistake',
  tradeKind: 'live',
  entry: 1.1,
  exit: 1.09,
  stopLoss: 1.095,
  initialStopLoss: 1.095,
  size: 1,
  pnl: -50,
  rMultiple: -1,
  resultSource: 'imported',
  openedAt: '2026-08-14',
  closedAt: '2026-08-15',
  note: '<p>旧复盘正文</p>',
  comments: [{ id: 'comment-1', text: '旧评论', createdAt: '2026-08-15' }],
  activities: [],
}

export function testSharedCopyActionCreatesANewPlanFromTheLatestStoreState(): void {
  const previous = useStore.getState()
  try {
    useStore.setState({ trades: [source] })
    const result = copyTradeRecord(source.id, {
      now: new Date('2026-08-16T09:00:00.000Z'),
      createId: () => 'shared-copy-result',
    })

    assert(result.status === 'copied', '共享复制动作必须报告复制成功')
    assert(result.copy.id === 'shared-copy-result', '共享复制动作必须写入指定的新记录')
    assert(result.copy.status === 'planned', '交易副本必须成为新计划')
    assert(result.copy.pnl === null && result.copy.rMultiple === null, '交易副本不得继承历史结果')
    assert(result.copy.reviewStatus === 'unreviewed', '交易副本不得继承复盘状态')
    assert(useStore.getState().trades.find((trade) => trade.id === source.id)?.status === 'loss', '复制不得修改源记录')
  } finally {
    useStore.setState(previous, true)
  }
}

export function testSharedCopyActionFailsClosedWhenTheSourceNoLongerExists(): void {
  const previous = useStore.getState()
  try {
    useStore.setState({ trades: [] })
    const result = copyTradeRecord(source.id)
    assert(result.status === 'source-missing', '源记录不存在时必须显式拒绝复制')
    assert(useStore.getState().trades.length === 0, '源记录不存在时不得创建任何副本')
  } finally {
    useStore.setState(previous, true)
  }
}



export function testSharedCopyActionReadsTheLatestTradingDayPreference(): void {
  const previous = useStore.getState()
  const early = new Date(2026, 0, 1, 2, 0)
  try {
    useStore.setState({ trades: [source], display: { ...previous.display, tradingDayStartHour: 6 } })
    const beforeBoundary = copyTradeRecord(source.id, { now: early, createId: () => 'copy-business-day' })
    assert(beforeBoundary.status === 'copied' && beforeBoundary.copy.openedAt === '2025-12-31', '详情和共享复制入口必须读取当前换日设置')
    useStore.setState({ display: { ...useStore.getState().display, tradingDayStartHour: 0 } })
    const calendarBoundary = copyTradeRecord(source.id, { now: early, createId: () => 'copy-calendar-day' })
    assert(calendarBoundary.status === 'copied' && calendarBoundary.copy.openedAt === '2026-01-01', '复制动作不得缓存旧的换日设置')
  } finally { useStore.setState(previous, true) }
}

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


import type { Trade } from '@/data/trades'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { useStore } from '@/store/useStore'

const source: Trade = {
  id: 'context-copy-source',
  ref: 'TRD-8',
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testContextMenuCopiesOneTradeIntoANewPlan(): void {
  const previous = useStore.getState()
  try {
    useStore.setState({ trades: [source] })
    const items = buildTradeCtxItems(source, {
      setStatus: () => {},
      requestTradeOpen: () => {},
      openComposer: () => {},
      removeTrade: () => {},
    })
    const copyItem = items.find(
      (item) => item.type === 'item' && item.label === '复制为新计划',
    )
    assert(copyItem?.type === 'item', '单条交易右键菜单必须提供“复制为新计划”')

    copyItem.onClick()

    const trades = useStore.getState().trades
    assert(trades.length === 2, '右键复制必须直接创建一条新计划')
    const copy = trades.find((trade) => trade.id !== source.id)
    assert(copy, '右键复制后必须存在不同 ID 的副本')
    assert(copy.ref !== source.ref, '右键复制必须分配新的交易编号')
    assert(copy.status === 'planned' && copy.tradeKind === 'live', '交易副本必须重置为同类型新计划')
    assert(copy.pnl === null && copy.rMultiple === null && copy.closedAt === null, '新计划不得继承历史结果')
    assert(copy.reviewStatus === 'unreviewed' && copy.comments?.length === 0, '新计划不得继承复盘完成状态')
    assert(useStore.getState().trades.find((trade) => trade.id === source.id)?.status === 'loss', '复制不得修改源交易')
  } finally {
    useStore.setState(previous, true)
  }
}

export function testContextMenuUsesTheCanonicalBusinessActionOrder(): void {
  const items = buildTradeCtxItems(source, {
    setStatus: () => {},
    requestTradeOpen: () => {},
    openComposer: () => {},
    removeTrade: () => {},
    createReviewCase: () => {},
    toggleStar: () => {},
    isStarred: () => false,
  })
  const labels = items
    .filter((item) => item.type === 'item')
    .map((item) => item.label)
  const businessLabels = ['编辑交易', '复制为新计划', '提炼为案例', '加入星标', '删除交易']
  const businessIndexes = businessLabels.map((label) => labels.indexOf(label))

  assert(businessIndexes.every((index) => index >= 0), '右键菜单必须包含全部适用的统一业务动作')
  assert(
    businessIndexes.every((index, position) => position === 0 || index > businessIndexes[position - 1]),
    '右键菜单业务动作必须遵循编辑、复制、提炼、星标、删除的固定顺序',
  )
}

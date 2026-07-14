import {
  flushNoteDraftToStore,
  flushNoteDraftsToStore,
  getNoteDraft,
  noteDraftCountForTests,
  resetNoteDraftsForTests,
  setNoteDraft,
} from '@/storage/noteDrafts'
import { useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testOlderDraftFlushCannotDeleteNewInput(): Promise<void> {
  const originalTrades = useStore.getState().trades
  const tradeId = 'note-draft-compare-test'

  resetNoteDraftsForTests()
  useStore.setState({
    trades: [{
      id: tradeId,
      ref: 'TRD-DRAFT-COMPARE',
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'open',
      conviction: 'medium',
      strategyId: 'strategy-test',
      tags: [],
      mistakeTags: [],
      reviewStatus: 'unreviewed',
      reviewCategory: 'normal',
      tradeKind: 'live',
      entry: 100,
      exit: null,
      stopLoss: null,
      initialStopLoss: null,
      size: 1,
      pnl: null,
      rMultiple: null,
      openedAt: '2026-07-14',
      closedAt: null,
      note: '',
    }],
  })

  try {
    const oldDraft = '<p>A</p>'
    const newDraft = '<p>B</p>'
    setNoteDraft(tradeId, oldDraft)
    const oldFlush = flushNoteDraftsToStore()
    setNoteDraft(tradeId, newDraft)
    await oldFlush

    assert(noteDraftCountForTests() === 0, '新草稿完成稳定冲洗后才可删除')
    assert(
      useStore.getState().trades.find((trade) => trade.id === tradeId)?.note === newDraft,
      '旧任务不得删除新草稿，稳定冲洗必须把新值写入 store',
    )
  } finally {
    resetNoteDraftsForTests()
    useStore.setState({ trades: originalTrades })
  }
}

export async function testSingleDraftFlushCannotDeleteNewInput(): Promise<void> {
  const originalTrades = useStore.getState().trades
  const tradeId = 'note-draft-single-compare-test'
  useStore.setState({
    trades: [{
      id: tradeId,
      ref: 'TRD-DRAFT-SINGLE',
      symbol: 'ETHUSDT',
      side: 'short',
      status: 'open',
      conviction: 'medium',
      strategyId: 'strategy-test',
      tags: [],
      mistakeTags: [],
      reviewStatus: 'unreviewed',
      reviewCategory: 'normal',
      tradeKind: 'live',
      entry: 100,
      exit: null,
      stopLoss: null,
      initialStopLoss: null,
      size: 1,
      pnl: null,
      rMultiple: null,
      openedAt: '2026-07-14',
      closedAt: null,
      note: '',
    }],
  })
  resetNoteDraftsForTests()

  try {
    setNoteDraft(tradeId, '<p>A</p>')
    const oldFlush = flushNoteDraftToStore(tradeId)
    setNoteDraft(tradeId, '<p>B</p>')
    const flushed = await oldFlush

    assert(flushed, '单条 flush 必须等待期间输入的新草稿稳定落盘')
    assert(getNoteDraft(tradeId) === undefined, '新草稿落盘后才可从草稿队列移除')
    assert(
      useStore.getState().trades.find((trade) => trade.id === tradeId)?.note === '<p>B</p>',
      '单条 flush 必须把期间输入的最新值写入 store',
    )
  } finally {
    resetNoteDraftsForTests()
    useStore.setState({ trades: originalTrades })
  }
}

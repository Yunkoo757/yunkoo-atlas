import type { Trade } from '@/data/trades'
import { prepareExistingComposerTrade } from '@/lib/tradeComposerSave'
import { useStore } from '@/store/useStore'

const reviewedTrade: Trade = {
  id: 'composer-race-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewedAt: '2026-07-14T08:00:00.000Z',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  stopLoss: 95,
  size: 1,
  pnl: 500,
  rMultiple: null,
  resultSource: 'pnl',
  timeframe: '1H',
  session: '',
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '<p>原笔记</p>',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testComposerUsesLatestTradeAfterDelayedImageSave(): Promise<void> {
  const previous = useStore.getState()
  let releaseImageSave!: (html: string) => void
  const imageSave = new Promise<string>((resolve) => {
    releaseImageSave = resolve
  })
  try {
    useStore.setState({ trades: [reviewedTrade], undoStack: [], redoStack: [] })
    const pending = prepareExistingComposerTrade({
      id: reviewedTrade.id,
      fields: {
        symbol: 'BTCUSDT',
        side: 'short',
        timeframe: '4H',
        session: '',
        strategyId: 'strategy-1',
        openedAt: '2026-07-01',
      },
      saveImages: () => imageSave,
      getLatest: (id) => useStore.getState().trades.find((trade) => trade.id === id),
    })

    useStore.getState().completeTradeClose(reviewedTrade.id, 'loss', {
      pnl: null,
      rMultiple: -1.5,
      resultSource: 'r',
      closedAt: '2026-07-14',
      reviewStatus: 'unreviewed',
      reviewedAt: null,
    })
    useStore.getState().updateNote(reviewedTrade.id, '<p>并发补充</p>')
    useStore.getState().updateTradeData(reviewedTrade.id, { reviewCategory: 'focus' })
    releaseImageSave('<img src="journal-asset://new-image" />')

    const prepared = await pending
    if (!prepared) throw new Error('the edited trade should still exist')
    useStore.getState().upsertTrade(prepared)
    const saved = useStore.getState().trades[0]!
    assert(saved.rMultiple === -1.5 && saved.status === 'loss', 'latest R and outcome must survive image wait')
    assert(saved.resultSource === 'r' && saved.pnl === null, 'latest result authority must survive image wait')
    assert(saved.reviewStatus === 'unreviewed', 'latest review state must survive image wait')
    assert(saved.reviewedAt === null, 'latest review timestamp must survive image wait')
    assert(saved.reviewCategory === 'focus', 'fields outside the composer must survive image wait')
    assert(saved.side === 'short' && saved.timeframe === '4H', 'owned form fields must still apply')
    assert(saved.note.includes('并发补充') && saved.note.includes('new-image'), 'image must append to latest note')
  } finally {
    useStore.setState({
      trades: previous.trades,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
      closeTradeRequest: previous.closeTradeRequest,
    })
  }
}

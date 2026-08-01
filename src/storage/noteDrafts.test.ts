import {
  flushNoteDraftToStore,
  flushNoteDraftsToStore,
  applyNoteDraftsToSnapshot,
  discardAllNoteDrafts,
  getNoteDraft,
  hasPendingNoteDrafts,
  noteDraftCountForTests,
  resetNoteDraftsForTests,
  setNoteDraft,
  QUICK_NOTE_DRAFT_PREFIX,
} from '@/storage/noteDrafts'
import { createQuickNote } from '@/data/quickNotes'
import { useStore } from '@/store/useStore'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testPendingNoteDraftStateClearsOnlyAfterSuccessfulFlush(): Promise<void> {
  const originalNotes = useStore.getState().quickNotes
  const note = createQuickNote(new Date('2026-07-28T08:00:00.000Z'))
  const draftId = `${QUICK_NOTE_DRAFT_PREFIX}${note.id}`
  resetNoteDraftsForTests()
  useStore.setState({ quickNotes: [note] })
  try {
    assert(!hasPendingNoteDrafts(), '无草稿时不得误报 pending')
    setNoteDraft(draftId, '<p>待冲洗</p>')
    assert(hasPendingNoteDrafts(), '草稿 set 后必须立即标记 pending')
    assert(await flushNoteDraftsToStore(), '合法草稿必须成功冲洗')
    assert(!hasPendingNoteDrafts(), '成功冲洗并写入 store 后必须清除 pending')
  } finally {
    resetNoteDraftsForTests()
    useStore.setState({ quickNotes: originalNotes })
  }
}

export async function testFailedNormalizationKeepsDraftForSuccessfulRetry(): Promise<void> {
  const originalNotes = useStore.getState().quickNotes
  const OriginalDOMParser = globalThis.DOMParser
  const note = createQuickNote(new Date('2026-07-28T09:00:00.000Z'))
  const draftId = `${QUICK_NOTE_DRAFT_PREFIX}${note.id}`
  resetNoteDraftsForTests()
  useStore.setState({ quickNotes: [note] })
  try {
    setNoteDraft(draftId, '<p>重试附件</p><img src="journal-asset://existing">')
    globalThis.DOMParser = class { parseFromString(): never { throw new Error('normalize failed') } } as typeof DOMParser
    assert(!(await flushNoteDraftToStore(draftId)), '首次归一化失败必须报告未完成')
    assert(hasPendingNoteDrafts() && getNoteDraft(draftId) !== undefined, '首次失败后必须保留 pending 草稿')
    globalThis.DOMParser = OriginalDOMParser
    setNoteDraft(draftId, '<p>重试附件已恢复</p>')
    assert(await flushNoteDraftToStore(draftId), '恢复后后续重试必须成功')
    assert(!hasPendingNoteDrafts(), '重试成功后才可清除 pending 草稿')
  } finally {
    globalThis.DOMParser = OriginalDOMParser
    resetNoteDraftsForTests()
    useStore.setState({ quickNotes: originalNotes })
  }
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

export async function testConflictRecoverySnapshotIncludesDraftAndDiscardInvalidatesInflightFlush(): Promise<void> {
  const originalTrades = useStore.getState().trades
  const tradeId = 'note-draft-conflict-recovery'
  const trade = {
    ...createFullPersistedSnapshotFixture().trades[0],
    id: tradeId,
    ref: 'TRD-DRAFT-RECOVERY',
    note: '<p>已提交</p>',
  }
  useStore.setState({ trades: [trade] })
  resetNoteDraftsForTests()

  try {
    const draft = '<p>尚未保存<img src="blob:http://localhost/preview" data-asset-id="prepared-draft"></p>'
    setNoteDraft(tradeId, draft)
    const recovery = applyNoteDraftsToSnapshot({
      ...createEmptyPersistedSnapshot(),
      trades: [trade],
      strategies: useStore.getState().strategies,
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: useStore.getState().display,
    })
    assert(
      recovery.trades[0]?.note.includes('src="journal-asset://prepared-draft"') &&
        !recovery.trades[0]?.note.includes('blob:'),
      '冲突恢复快照必须把真实 Editor blob+data-asset-id 草稿转为可恢复引用',
    )

    const inflight = flushNoteDraftToStore(tradeId)
    discardAllNoteDrafts()
    await inflight
    assert(
      useStore.getState().trades[0]?.note === '<p>已提交</p>',
      '加载最新版使草稿失效后，在途 flush 不得延迟写回旧内容',
    )
  } finally {
    resetNoteDraftsForTests()
    useStore.setState({ trades: originalTrades })
  }
}

export async function testQuickNoteDraftFlushesToIndependentNoteStore(): Promise<void> {
  const originalNotes = useStore.getState().quickNotes
  const note = createQuickNote(new Date('2026-07-18T08:00:00.000Z'))
  const draftId = `${QUICK_NOTE_DRAFT_PREFIX}${note.id}`
  resetNoteDraftsForTests()
  useStore.setState({ quickNotes: [note] })
  try {
    setNoteDraft(draftId, '<p>随手记录，不是一笔交易</p>')
    assert(await flushNoteDraftToStore(draftId), '随记草稿必须能够稳定写入 store')
    assert(
      useStore.getState().quickNotes[0]?.contentHtml === '<p>随手记录，不是一笔交易</p>',
      '随记草稿必须写入 quickNotes，而不是交易 note',
    )
    assert(
      useStore.getState().quickNotes[0]?.title === '随手记录，不是一笔交易',
      '自动标题必须在随记草稿写入时同步正文开头',
    )

    useStore.getState().updateQuickNote(note.id, { title: '手动标题', titleMode: 'manual' })
    setNoteDraft(draftId, '<p>正文后来继续变化</p>')
    assert(await flushNoteDraftToStore(draftId), '手动标题后的随记草稿仍须正常写入')
    assert(
      useStore.getState().quickNotes[0]?.title === '手动标题',
      '用户手动编辑标题后，正文不得再次覆盖标题',
    )
  } finally {
    resetNoteDraftsForTests()
    useStore.setState({ quickNotes: originalNotes })
  }
}

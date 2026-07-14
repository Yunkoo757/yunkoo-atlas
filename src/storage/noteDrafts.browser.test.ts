import type { Trade } from '@/data/trades'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function run(): Promise<void> {
  const saveStarted = deferred<void>()
  const allowOldImage = deferred<string>()
  Object.defineProperty(window, 'journalBridge', {
    configurable: true,
    value: {
      isElectron: true,
      saveAsset: async () => {
        saveStarted.resolve()
        return allowOldImage.promise
      },
    },
  })

  const [{ useStore }, drafts] = await Promise.all([
    import('@/store/useStore'),
    import('@/storage/noteDrafts'),
  ])
  const tradeId = 'note-draft-ordering-browser'
  const trade: Trade = {
    id: tradeId,
    ref: 'TRD-NOTE-ORDER',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'open',
    conviction: 'medium',
    strategyId: 'strategy-test',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
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
  }
  useStore.setState({ trades: [trade] })
  drafts.resetNoteDraftsForTests()

  drafts.setNoteDraft(tradeId, '<p>A</p><img src="data:image/png;base64,QQ==">')
  const oldFlush = drafts.flushNoteDraftToStore(tradeId)
  await saveStarted.promise
  drafts.setNoteDraft(tradeId, '<p>最新 B</p>')
  const newFlush = drafts.flushNoteDraftToStore(tradeId)
  const appended = drafts.appendAssetToNoteDraft(tradeId, 'route-asset')
  allowOldImage.resolve('asset-old')

  const results = await Promise.all([oldFlush, newFlush, appended])
  assert(results.every(Boolean), '并发 flush 都必须等待最新草稿稳定落盘')
  assert(drafts.getNoteDraft(tradeId) === undefined, '稳定落盘后不应残留草稿')
  assert(
    useStore.getState().trades.find((item) => item.id === tradeId)?.note ===
      '<p>最新 B</p>\n<img src="journal-asset://route-asset">',
    '较慢的旧图片草稿不得反向覆盖最新输入，卸载后的附件也必须合并到最新值',
  )
  drafts.resetNoteDraftsForTests()
  Reflect.deleteProperty(window, 'journalBridge')
}

declare global {
  interface Window {
    __noteDraftOrderingTest?: Promise<void>
  }
}

window.__noteDraftOrderingTest = run()

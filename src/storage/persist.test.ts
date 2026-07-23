import { getStorage } from '@/storage'
import {
  disablePersistWrites,
  discardPendingAndResumePersist,
  enablePersistWrites,
  flushPersistNow,
  getPersistSuspendDepth,
  hasPendingChanges,
  pickPersisted,
  schedulePersist,
  setPreFlushCallback,
  suspendPersist,
} from '@/storage/persist'
import type { PersistedSnapshot } from '@/storage/types'
import { PERSISTED_SNAPSHOT_FIELDS } from '@/storage/persistedKeys'
import { useSaveStatus } from '@/store/saveStatus'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import {
  flushNoteDraftsToStore,
  noteDraftCountForTests,
  resetNoteDraftsForTests,
  setNoteDraft,
} from '@/storage/noteDrafts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitUntil(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(message)
}

function snapshotWithName(displayName: string): PersistedSnapshot {
  useStore.setState((state) => ({
    profile: { ...state.profile, displayName },
  }))
  return pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
}

export function testPickPersistedAlwaysWritesEveryCanonicalField(): void {
  const state = useStore.getState()
  const empty = pickPersisted(state, {})
  assert(
    JSON.stringify(Object.keys(empty).sort()) === JSON.stringify([...PERSISTED_SNAPSHOT_FIELDS].sort()),
    'autosave writer 的字段集合必须始终与 16 字段注册表完全一致',
  )
  assert(Object.prototype.hasOwnProperty.call(empty, 'shortcuts'), '空快捷键也必须显式写出 shortcuts')
  assert(JSON.stringify(empty.shortcuts) === '{}', '空快捷键必须序列化为空对象')

  const custom = pickPersisted(state, {
    'nav.list': { key: 'j', mod: true },
  })
  const binding = custom.shortcuts['nav.list']
  assert(!Array.isArray(binding) && binding?.key === 'j', '自定义快捷键覆盖必须保留')
}

export async function testExplicitFlushPersistsChangesScheduledDuringAnActiveSave(): Promise<void> {
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const firstSave = deferred()
  const secondSave = deferred()
  const savedNames: string[] = []
  let activeSaves = 0
  let maxActiveSaves = 0

  disablePersistWrites()
  setPreFlushCallback(null)
  useSaveStatus.getState().reset()
  storage.saveSnapshot = async (snapshot) => {
    activeSaves += 1
    maxActiveSaves = Math.max(maxActiveSaves, activeSaves)
    savedNames.push(snapshot.profile?.displayName ?? '')
    if (savedNames.length === 1) await firstSave.promise
    if (savedNames.length === 2) await secondSave.promise
    activeSaves -= 1
  }

  try {
    enablePersistWrites()
    schedulePersist(snapshotWithName('A'))
    const flushPromise = flushPersistNow()
    await Promise.resolve()

    schedulePersist(snapshotWithName('B'))
    assert(useSaveStatus.getState().status === 'dirty', 'B 到达后保存状态应保持未保存')
    firstSave.resolve()
    await waitUntil(() => savedNames.length >= 2, '尾随快照 B 未开始写盘')
    assert(useSaveStatus.getState().status === 'saving', 'B 尚未写完时不得提前显示已保存')
    secondSave.resolve()
    await flushPromise

    assert(savedNames.join(',') === 'A,B', '显式 flush 返回前必须依次落盘 A 与最新 B')
    assert(maxActiveSaves === 1, '快照写盘必须保持串行')
    assert(useSaveStatus.getState().status === 'saved', '最新 B 落盘后才能显示已保存')
    useSaveStatus.getState().setDirty()
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert(
      useSaveStatus.getState().status === 'dirty',
      '追写完成后不得遗留空跑 timer 覆盖后续保存状态',
    )
  } finally {
    disablePersistWrites()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useSaveStatus.getState().reset()
  }
}

export async function testFailedExplicitFlushStaysInErrorAndCanRetryTheLatestStore(): Promise<void> {
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const retrySave = deferred()
  const savedNames: string[] = []
  let attempt = 0

  disablePersistWrites()
  setPreFlushCallback(null)
  useSaveStatus.getState().reset()
  storage.saveSnapshot = async (snapshot) => {
    attempt += 1
    savedNames.push(snapshot.profile?.displayName ?? '')
    if (attempt === 1) throw new Error('disk full')
    await retrySave.promise
  }

  const originalConsoleError = console.error
  console.error = () => {}
  try {
    enablePersistWrites()
    snapshotWithName('A')
    await flushPersistNow().then(
      () => {
        throw new Error('首次写盘失败必须向显式调用方抛出')
      },
      () => {},
    )
    assert(useSaveStatus.getState().status === 'error', '写盘失败后不得显示已保存')
    assert(
      useSaveStatus.getState().errorMessage === 'disk full',
      '写盘失败后必须保留可呈现给用户的具体原因',
    )

    snapshotWithName('B')
    const retry = flushPersistNow()
    await waitUntil(() => attempt >= 2, '失败后的显式保存未开始重试')
    assert(useSaveStatus.getState().status === 'saving', '重试尚未完成时应保持保存中')
    assert(useSaveStatus.getState().errorMessage === null, '开始重试时应清除旧错误原因')
    retrySave.resolve()
    await retry

    assert(savedNames.join(',') === 'A,B', '失败后的显式重试必须从最新 store 重建快照')
    assert(useSaveStatus.getState().status === 'saved', '最新快照重试成功后才能显示已保存')
    assert(useSaveStatus.getState().errorMessage === null, '重试成功后不得残留旧错误原因')
  } finally {
    console.error = originalConsoleError
    disablePersistWrites()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useSaveStatus.getState().reset()
  }
}

export async function testLaterPreFlushFailureCannotLeaveAFalseSavedState(): Promise<void> {
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  let preFlushCalls = 0
  let saveCount = 0

  disablePersistWrites()
  useSaveStatus.getState().reset()
  storage.saveSnapshot = async () => {
    saveCount += 1
  }
  setPreFlushCallback(async () => {
    preFlushCalls += 1
    if (preFlushCalls === 2) throw new Error('draft image failed')
  })

  try {
    enablePersistWrites()
    await flushPersistNow().then(
      () => {
        throw new Error('后续 pre-flush 失败必须让显式 flush 拒绝')
      },
      () => {},
    )

    assert(saveCount === 1, '第二轮 pre-flush 应发生在首个快照写盘之后')
    assert(useSaveStatus.getState().status === 'error', 'pre-flush 失败不得遗留已保存状态')
    assert(hasPendingChanges(), 'pre-flush 失败后关闭保护必须继续识别未完成内容')
  } finally {
    disablePersistWrites()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useSaveStatus.getState().reset()
  }
}

export async function testStablePreFlushCheckDoesNotExposeSavedBeforeItFinishes(): Promise<void> {
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const stableCheck = deferred()
  let preFlushCalls = 0

  disablePersistWrites()
  useSaveStatus.getState().reset()
  storage.saveSnapshot = async () => {}
  setPreFlushCallback(async () => {
    preFlushCalls += 1
    if (preFlushCalls === 2) await stableCheck.promise
  })

  try {
    enablePersistWrites()
    const flush = flushPersistNow()
    await waitUntil(() => preFlushCalls === 2, '写盘后未执行稳定性 pre-flush')
    assert(useSaveStatus.getState().status === 'saving', '稳定性检查未完成时不得显示已保存')
    assert(hasPendingChanges(), '稳定性检查未完成时关闭保护必须保持启用')
    stableCheck.resolve()
    await flush
    assert(useSaveStatus.getState().status === 'saved', '稳定性检查完成后才可显示已保存')
  } finally {
    stableCheck.resolve()
    disablePersistWrites()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useSaveStatus.getState().reset()
  }
}

export async function testContinuouslyChangingPreFlushIsBoundedAndRemainsPending(): Promise<void> {
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  let preFlushCalls = 0
  let saveCount = 0

  disablePersistWrites()
  useSaveStatus.getState().reset()
  storage.saveSnapshot = async () => {
    saveCount += 1
  }
  setPreFlushCallback(async () => {
    preFlushCalls += 1
    snapshotWithName(`持续变化-${preFlushCalls}`)
  })

  try {
    enablePersistWrites()
    await flushPersistNow().then(
      () => {
        throw new Error('持续变化的 pre-flush 必须在边界内拒绝')
      },
      () => {},
    )

    assert(preFlushCalls <= 9 && saveCount <= 8, '稳定冲洗必须有明确次数上限')
    assert(useSaveStatus.getState().status === 'error', '达到稳定冲洗上限后应显示错误')
    assert(hasPendingChanges(), '达到上限后必须保留最新快照供重试')
  } finally {
    disablePersistWrites()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useSaveStatus.getState().reset()
  }
}

export async function testSecondExplicitFlushCapturesLatestStoreDuringAnActiveSave(): Promise<void> {
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const firstSave = deferred()
  const savedNames: string[] = []
  let activeSaves = 0
  let maxActiveSaves = 0

  disablePersistWrites()
  setPreFlushCallback(null)
  useSaveStatus.getState().reset()
  storage.saveSnapshot = async (snapshot) => {
    activeSaves += 1
    maxActiveSaves = Math.max(maxActiveSaves, activeSaves)
    savedNames.push(snapshot.profile?.displayName ?? '')
    if (savedNames.length === 1) await firstSave.promise
    activeSaves -= 1
  }

  try {
    enablePersistWrites()
    snapshotWithName('A')
    const firstFlush = flushPersistNow()
    await Promise.resolve()

    snapshotWithName('B')
    const secondFlush = flushPersistNow()
    firstSave.resolve()
    await Promise.all([firstFlush, secondFlush])

    assert(savedNames.join(',') === 'A,B', '第二次显式 flush 必须捕获并落盘最新 store')
    assert(maxActiveSaves === 1, '两个显式 flush 也不得并行写盘')
  } finally {
    disablePersistWrites()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useSaveStatus.getState().reset()
  }
}

export async function testExplicitFlushPersistsNoteDraftCreatedDuringAnActiveSave(): Promise<void> {
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const originalTrades = useStore.getState().trades
  const firstSave = deferred()
  const savedNotes: string[] = []
  const tradeId = 'persist-note-tail-test'

  disablePersistWrites()
  resetNoteDraftsForTests()
  useSaveStatus.getState().reset()
  useStore.setState({
    trades: [{
      id: tradeId,
      ref: 'TRD-PERSIST-TAIL',
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
  storage.saveSnapshot = async (snapshot) => {
    savedNotes.push(snapshot.trades.find((trade) => trade.id === tradeId)?.note ?? '')
    if (savedNotes.length === 1) await firstSave.promise
  }
  setPreFlushCallback(async () => {
    const complete = await flushNoteDraftsToStore()
    if (!complete) throw new Error('笔记草稿尚未完全写入 store')
  })

  try {
    enablePersistWrites()
    setNoteDraft(tradeId, '<p>A</p>')
    const flush = flushPersistNow()
    await waitUntil(() => savedNotes.length === 1, '笔记快照 A 未开始写盘')

    setNoteDraft(tradeId, '<p>B</p>')
    firstSave.resolve()
    await flush

    assert(savedNotes.join(',') === '<p>A</p>,<p>B</p>', '显式 flush 返回前必须追写期间新增的草稿 B')
    assert(noteDraftCountForTests() === 0, '追写完成后不得遗留未处理草稿')
    assert(
      useStore.getState().trades.find((trade) => trade.id === tradeId)?.note === '<p>B</p>',
      '最终 store 必须包含最新草稿 B',
    )
    assert(useSaveStatus.getState().status === 'saved', '最新草稿 B 落盘后才能显示已保存')
  } finally {
    firstSave.resolve()
    disablePersistWrites()
    resetNoteDraftsForTests()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useStore.setState({ trades: originalTrades })
    useSaveStatus.getState().reset()
  }
}

export async function testDiscardPendingResumeCannotWriteThePreviousLibrarySnapshot(): Promise<void> {
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  let saveCount = 0

  disablePersistWrites()
  setPreFlushCallback(null)
  useSaveStatus.getState().reset()
  storage.saveSnapshot = async () => {
    saveCount += 1
  }

  try {
    enablePersistWrites()
    suspendPersist()
    schedulePersist(snapshotWithName('旧资料库快照'))
    discardPendingAndResumePersist()

    assert(getPersistSuspendDepth() === 0, '丢弃旧库待写后应释放一层 suspend gate')
    assert(!hasPendingChanges(), '路径切换失败后必须丢弃旧库的 pending 快照')
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert(saveCount === 0, '丢弃旧库待写不得启动 debounce 或立即写盘')
  } finally {
    disablePersistWrites()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useSaveStatus.getState().reset()
  }
}

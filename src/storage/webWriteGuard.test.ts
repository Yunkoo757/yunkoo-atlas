import {
  WebStorageWriteFrozenError,
  assertWebWriteAllowed,
  clearWebWriteConflictAfterReload,
  getWebWriteGuardState,
  initializeWebWriterOwnership,
  notifyWebRevisionCommitted,
  reportWebRevisionConflict,
  releaseWebWriterOwnership,
  requestWebWriterOwnership,
  resetWebWriteGuardForTests,
  type WebLockLike,
  type WebLockManagerLike,
} from '@/storage/webWriteGuard'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testWebWriteGuardFallsBackToCasWhenWebLocksAreUnavailable(): Promise<void> {
  resetWebWriteGuardForTests()
  await initializeWebWriterOwnership('library-a', { lockManager: null, broadcastFactory: null })

  const state = getWebWriteGuardState()
  assert(state.phase === 'editable', '不支持 Web Locks 时应允许编辑，并由 CAS 保证正确性')
  assert(state.lockSupported === false, 'fallback 状态必须明确记录 Web Locks 不可用')
  assertWebWriteAllowed()
}

export async function testWebWriteGuardWaitsForExclusiveOwnershipBeforeEditing(): Promise<void> {
  resetWebWriteGuardForTests()
  let waitingCallback: ((lock: WebLockLike | null) => Promise<void> | void) | null = null
  const lockManager: WebLockManagerLike = {
    async request(_name, options, callback) {
      if (options.ifAvailable) return callback(null)
      waitingCallback = callback
      return undefined
    },
  }

  await initializeWebWriterOwnership('library-b', { lockManager, broadcastFactory: null })
  assert(getWebWriteGuardState().phase === 'readonly', '未取得独占锁的标签页必须只读')

  let blocked = false
  try {
    assertWebWriteAllowed()
  } catch (error) {
    blocked = error instanceof WebStorageWriteFrozenError
  }
  assert(blocked, '只读标签页必须在存储入口阻止写入')

  const request = requestWebWriterOwnership()
  await Promise.resolve()
  assert(getWebWriteGuardState().phase === 'requesting', '请求所有权期间仍不可编辑')
  const grant = waitingCallback as ((lock: WebLockLike | null) => Promise<void> | void) | null
  assert(grant !== null, '请求所有权必须等待锁管理器授予')
  void grant({ name: 'linear-journal:library-b:writer' })
  await request
  assert(getWebWriteGuardState().phase === 'editable', '仅在独占锁授予后恢复编辑')

  releaseWebWriterOwnership()
  assert(getWebWriteGuardState().phase === 'readonly', '独占锁释放或丢失后必须立即冻结编辑')
}

export async function testRevisionConflictFreezesUntilLatestSnapshotIsLoaded(): Promise<void> {
  resetWebWriteGuardForTests()
  await initializeWebWriterOwnership('library-c', { lockManager: null, broadcastFactory: null })
  reportWebRevisionConflict(2, 3)

  const conflict = getWebWriteGuardState()
  assert(conflict.phase === 'conflict', 'CAS 冲突必须进入不可绕过的冻结状态')
  assert(conflict.expectedRevision === 2 && conflict.actualRevision === 3, '冲突状态必须保留 revision 证据')

  let blocked = false
  try {
    assertWebWriteAllowed()
  } catch (error) {
    blocked = error instanceof WebStorageWriteFrozenError
  }
  assert(blocked, '冲突后所有后续写入必须冻结')

  clearWebWriteConflictAfterReload(3)
  assert(getWebWriteGuardState().phase === 'editable', '加载最新版后才能解除无锁模式冲突冻结')
}

export async function testBroadcastChannelCarriesOnlyOwnershipAndRevisionMetadata(): Promise<void> {
  resetWebWriteGuardForTests()
  const messages: Array<Record<string, unknown>> = []
  const channel = {
    onmessage: null,
    postMessage(message: unknown) {
      messages.push(message as Record<string, unknown>)
    },
    close() {},
  }
  const lockManager: WebLockManagerLike = {
    async request(name, _options, callback) {
      void callback({ name })
      return undefined
    },
  }
  await initializeWebWriterOwnership('library-events', {
    lockManager,
    broadcastFactory: () => channel,
  })
  notifyWebRevisionCommitted(7)

  assert(messages.length === 2, '必须广播所有权和 revision 两类通知')
  assert(messages[0]?.type === 'ownership' && messages[1]?.type === 'revision', '广播类型必须受限')
  for (const message of messages) {
    const keys = Object.keys(message).sort().join(',')
    const expected = message.type === 'ownership'
      ? 'libraryId,status,tabId,type'
      : 'libraryId,revision,tabId,type'
    assert(keys === expected, 'BroadcastChannel 不得携带 snapshot、附件或其他业务数据')
  }
  resetWebWriteGuardForTests()
}

export async function testReleasedLockCannotBecomeEditableWhenConflictIsCleared(): Promise<void> {
  resetWebWriteGuardForTests()
  const lockManager: WebLockManagerLike = {
    async request(name, _options, callback) {
      void callback({ name })
      return undefined
    },
  }
  await initializeWebWriterOwnership('library-conflict-release', {
    lockManager,
    broadcastFactory: null,
  })
  reportWebRevisionConflict(8, 9)
  releaseWebWriterOwnership()
  clearWebWriteConflictAfterReload(9)
  assert(
    getWebWriteGuardState().phase === 'readonly',
    'conflict 期间释放真实锁后，加载最新版也不得在未重新持锁时恢复编辑',
  )
}

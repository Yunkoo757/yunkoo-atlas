export {}

declare global {
  interface Window {
    __webConcurrencyTwoContextTest?: Promise<void>
  }
}

interface ContextResponse {
  contextId: string
  requestId?: string
  ready?: boolean
  ok?: boolean
  result?: any
  error?: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`删除测试数据库被阻塞：${name}`))
  })
}

async function createContext(id: string, databaseName: string): Promise<{
  frame: HTMLIFrameElement
  send(command: string, payload?: Record<string, unknown>): Promise<any>
}> {
  const frame = document.createElement('iframe')
  frame.src = `/src/storage/webConcurrencyContext.fixture.html?id=${id}&db=${encodeURIComponent(databaseName)}`
  document.body.appendChild(frame)
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`上下文 ${id} 启动超时`)), 5_000)
    const listener = (event: MessageEvent<ContextResponse>) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return
      if (event.data.contextId !== id || !event.data.ready) return
      window.clearTimeout(timeout)
      window.removeEventListener('message', listener)
      resolve()
    }
    window.addEventListener('message', listener)
  })
  return {
    frame,
    send(command, payload = {}) {
      const requestId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error(`${id}:${command} 超时`)), 10_000)
        const listener = (event: MessageEvent<ContextResponse>) => {
          if (event.origin !== location.origin || event.source !== frame.contentWindow) return
          if (event.data.contextId !== id || event.data.requestId !== requestId) return
          window.clearTimeout(timeout)
          window.removeEventListener('message', listener)
          if (event.data.ok) resolve(event.data.result)
          else reject(new Error(event.data.error ?? `${id}:${command} 失败`))
        }
        window.addEventListener('message', listener)
        frame.contentWindow!.postMessage({ requestId, command, payload }, location.origin)
      })
    },
  }
}

async function run(): Promise<void> {
  const databaseName = `linear-journal-web4-${crypto.randomUUID()}`
  await deleteDatabase(databaseName)
  const first = await createContext('first', databaseName)
  const second = await createContext('second', databaseName)

  try {
    const lockLibraryId = 'web4-lock-library'
    const firstOwnership = await first.send('init-ownership', { libraryId: lockLibraryId, mode: 'actual' })
    const secondOwnership = await second.send('init-ownership', { libraryId: lockLibraryId, mode: 'actual' })
    assert(firstOwnership.phase === 'editable' && firstOwnership.lockSupported, '首个上下文必须取得独占 Web Lock')
    assert(secondOwnership.phase === 'readonly' && secondOwnership.lockSupported, '第二上下文在有锁模式必须只读')
    await first.send('release')
    const transferred = await second.send('request-ownership')
    assert(transferred.phase === 'editable', '当前持有者释放后，请求方才能获得编辑权')

    await first.send('init-ownership', { libraryId: lockLibraryId, mode: 'fallback' })
    await second.send('init-ownership', { libraryId: lockLibraryId, mode: 'fallback' })
    await first.send('open')
    await second.send('open')

    await first.send('load')
    await first.send('prepare', { label: 'seed' })
    assert((await first.send('save')).ok, 'seed 必须通过 CAS 0→1')
    const firstBaseline = await first.send('load')
    const secondBaseline = await second.send('load')
    assert(firstBaseline.revision === 1 && secondBaseline.revision === 1, '两个上下文必须从同一 revision 开始编辑')

    await first.send('prepare', { label: 'winner' })
    const prepared = await second.send('prepare', { label: 'stale-local-copy', withAsset: true })
    assert((await first.send('save')).ok, '首个 CAS writer 必须成功')
    const stale = await second.send('save')
    assert(!stale.ok && stale.code === 'storage-revision-conflict', '第二 writer 必须收到 typed CAS conflict')
    assert(stale.state.phase === 'conflict', 'stale 上下文必须立即冻结')
    const committedAfterConflict = await first.send('load')
    assert(
      committedAfterConflict.revision === 2 && committedAfterConflict.label === 'winner',
      'stale CAS 不得改变已提交 snapshot 或 revision',
    )
    assert(
      !(await first.send('read-asset', { assetId: prepared.assetId })).found,
      'stale 标签页 prepared asset 不得部分写入共享 IndexedDB',
    )

    const recovery = await second.send('recovery')
    assert(recovery.complete, 'prepared asset 可读时本标签页恢复副本必须完整')
    assert(recovery.assetIds.includes(prepared.assetId), '恢复副本必须包含 stale 标签页 prepared asset')
    assert(recovery.label === 'stale-local-copy', '恢复副本必须保留 stale 标签页未保存内容')

    const latest = await second.send('reload-latest')
    assert(latest.revision === 2 && latest.label === 'winner', '加载最新版必须得到获胜 writer 的快照')
    assert(latest.state.phase === 'editable', '无锁 fallback 加载最新版后可基于新 revision 恢复编辑')
  } finally {
    await Promise.allSettled([first.send('close'), second.send('close')])
    first.frame.remove()
    second.frame.remove()
    await deleteDatabase(databaseName)
  }
}

window.__webConcurrencyTwoContextTest = run()

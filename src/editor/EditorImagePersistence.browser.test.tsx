import React from 'react'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import {
  getNoteDraft,
  resetNoteDraftsForTests,
} from '@/storage/noteDrafts'
import {
  pendingStorageOperationCountForTests,
  waitForPendingStorageOperations,
} from '@/storage/pendingOperations'
import { Editor } from './Editor'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function trade(id: string, note: string): Trade {
  return {
    id,
    ref: `TRD-${id}`,
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
    note,
  }
}

async function pasteImage(
  root: Root,
  container: HTMLElement,
  tradeId: string,
  content: string,
): Promise<TiptapEditor> {
  flushSync(() => {
    root.render(
      <div data-editor-host>
        <Editor
          content={content}
          noteDraftId={tradeId}
          onChange={() => {}}
        />
      </div>,
    )
  })
  const editor = container.querySelector<HTMLElement>('.ProseMirror')
  assert(editor, '真实 Editor 必须挂载 ProseMirror')
  const tiptapEditor = (editor as HTMLElement & { editor?: TiptapEditor }).editor
  assert(tiptapEditor, '真实 ProseMirror DOM 必须暴露对应的 TipTap Editor 实例')

  dispatchImagePaste(editor)
  return tiptapEditor
}

function dispatchImagePaste(editor: HTMLElement): void {
  const transfer = new DataTransfer()
  transfer.items.add(new File([new Uint8Array([1, 2, 3])], 'chart.png', { type: 'image/png' }))
  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: transfer,
  })
  editor.dispatchEvent(event)
  assert(event.defaultPrevented, 'TipTap 必须接管图片粘贴')
}

function leaveEditor(editor: TiptapEditor, container: HTMLElement): void {
  // useEditor 的卸载清理最终调用同一个 destroy；直接触发它可避开 React dev build
  // 对 TipTap 已自行移除 DOM 的重复 removeChild 噪声，同时保留真实 Editor 生命周期语义。
  editor.destroy()
  assert(editor.isDestroyed, '模拟切换路由后原 TipTap Editor 必须已销毁')
  assert(!container.querySelector('.ProseMirror'), '销毁后原 ProseMirror DOM 必须移除')
  container.remove()
}

async function run(): Promise<void> {
  const saveStarted = deferred<void>()
  const allowSave = deferred<string>()
  const objectUrlStarted = deferred<void>()
  const allowObjectUrl = deferred<{ id: string; mime: string; bytes: number[] }>()
  const rejectedObjectUrlStarted = deferred<void>()
  const rejectObjectUrl = deferred<{ id: string; mime: string; bytes: number[] } | null>()
  const nullObjectUrlStarted = deferred<void>()
  const allowNullObjectUrl = deferred<{ id: string; mime: string; bytes: number[] } | null>()
  let scenario:
    | 'slow-save'
    | 'slow-object-url'
    | 'object-url-reject'
    | 'object-url-null'
    | 'two-editors' = 'slow-save'
  let objectUrlReads = 0

  Object.defineProperty(window, 'journalBridge', {
    configurable: true,
    value: {
      isElectron: true,
      saveAsset: async () => {
        if (scenario === 'slow-save') {
          saveStarted.resolve()
          return allowSave.promise
        }
        if (scenario === 'slow-object-url') return 'asset-after-object-url'
        if (scenario === 'object-url-reject') return 'asset-after-object-url-reject'
        if (scenario === 'object-url-null') return 'asset-after-object-url-null'
        return 'asset-first-editor'
      },
      getAssetBytes: async (id: string) => {
        objectUrlReads += 1
        if (scenario === 'two-editors') return { id, mime: 'image/png', bytes: [1, 2, 3] }
        if (scenario === 'object-url-reject') {
          rejectedObjectUrlStarted.resolve()
          return rejectObjectUrl.promise
        }
        if (scenario === 'object-url-null') {
          nullObjectUrlStarted.resolve()
          return allowNullObjectUrl.promise
        }
        objectUrlStarted.resolve()
        return allowObjectUrl.promise
      },
    },
  })

  const slowSaveTrade = trade('slow-save', '<p>原交易 A</p>')
  const slowObjectUrlTrade = trade('slow-object-url', '<p>原交易 B</p>')
  const rejectedObjectUrlTrade = trade('object-url-reject', '<p>原交易 C</p>')
  const nullObjectUrlTrade = trade('object-url-null', '<p>原交易 D</p>')
  useStore.setState({
    trades: [slowSaveTrade, slowObjectUrlTrade, rejectedObjectUrlTrade, nullObjectUrlTrade],
  })
  resetNoteDraftsForTests()

  const firstContainer = document.createElement('div')
  document.body.append(firstContainer)
  const firstRoot = createRoot(firstContainer)
  const firstEditor = await pasteImage(firstRoot, firstContainer, slowSaveTrade.id, slowSaveTrade.note)
  await saveStarted.promise
  assert(pendingStorageOperationCountForTests() === 1, '慢 saveAsset 必须仍计入 pending operation')

  leaveEditor(firstEditor, firstContainer)
  allowSave.resolve('asset-after-save')
  await waitForPendingStorageOperations()

  const savedAfterUnmount = useStore.getState().trades.find((item) => item.id === slowSaveTrade.id)?.note ?? ''
  assert(savedAfterUnmount.includes('<p>原交易 A</p>'), '卸载补写不得覆盖原交易正文')
  assert(
    savedAfterUnmount.includes('journal-asset://asset-after-save'),
    'saveAsset 返回后发现 Editor 已卸载，必须把永久附件引用补回原交易',
  )
  assert(objectUrlReads === 0, 'saveAsset 后已卸载时不应再读取临时 Object URL')
  assert(getNoteDraft(slowSaveTrade.id) === undefined, '卸载补写成功后必须清空原交易草稿')
  assert(pendingStorageOperationCountForTests() === 0, '卸载补写完成后 pending operation 必须归零')

  scenario = 'slow-object-url'
  const secondContainer = document.createElement('div')
  document.body.append(secondContainer)
  const secondRoot = createRoot(secondContainer)
  const secondEditor = await pasteImage(
    secondRoot,
    secondContainer,
    slowObjectUrlTrade.id,
    slowObjectUrlTrade.note,
  )
  await objectUrlStarted.promise
  assert(pendingStorageOperationCountForTests() === 1, '慢 Object URL 读取必须仍计入 pending operation')

  leaveEditor(secondEditor, secondContainer)
  allowObjectUrl.resolve({
    id: 'asset-after-object-url',
    mime: 'image/png',
    bytes: [1, 2, 3],
  })
  await waitForPendingStorageOperations()

  const savedAfterObjectUrl = useStore.getState().trades.find((item) => item.id === slowObjectUrlTrade.id)?.note ?? ''
  assert(savedAfterObjectUrl.includes('<p>原交易 B</p>'), 'Object URL 后卸载补写不得覆盖原交易正文')
  assert(
    savedAfterObjectUrl.includes('journal-asset://asset-after-object-url'),
    'Object URL 返回后发现 Editor 已卸载，必须把永久附件引用补回原交易',
  )
  assert(Number(objectUrlReads) === 1, 'Object URL 边界测试必须真实读取一次附件')
  assert(getNoteDraft(slowObjectUrlTrade.id) === undefined, 'Object URL 后卸载补写成功后必须清空草稿')
  assert(pendingStorageOperationCountForTests() === 0, '第二条卸载补写完成后 pending operation 必须归零')

  const verifyDestroyedObjectUrlFailure = async ({
    failureScenario,
    tradeRecord,
    started,
    settle,
    expectedAssetId,
    label,
  }: {
    failureScenario: 'object-url-reject' | 'object-url-null'
    tradeRecord: Trade
    started: Promise<void>
    settle: () => void
    expectedAssetId: string
    label: string
  }) => {
    scenario = failureScenario
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const editor = await pasteImage(root, container, tradeRecord.id, tradeRecord.note)
    await started
    assert(pendingStorageOperationCountForTests() === 1, `${label} 返回前必须仍计入 pending operation`)

    leaveEditor(editor, container)
    const originalCreateObjectUrl = URL.createObjectURL
    let fallbackObjectUrls = 0
    URL.createObjectURL = () => {
      fallbackObjectUrls += 1
      return `blob:unexpected-${failureScenario}`
    }
    try {
      settle()
      await waitForPendingStorageOperations()
    } finally {
      URL.createObjectURL = originalCreateObjectUrl
    }

    const saved = useStore.getState().trades.find((item) => item.id === tradeRecord.id)?.note ?? ''
    assert(saved.includes(tradeRecord.note), `${label} 后的补写不得覆盖原交易正文`)
    assert(
      saved.includes(`journal-asset://${expectedAssetId}`),
      `${label} 后发现 Editor 已卸载，必须把已保存的永久附件引用补回原交易`,
    )
    assert(fallbackObjectUrls === 0, `${label} 后 Editor 已卸载时不得创建 fallback Blob URL`)
    assert(getNoteDraft(tradeRecord.id) === undefined, `${label} 后补写成功必须清空草稿`)
    assert(pendingStorageOperationCountForTests() === 0, `${label} 后 pending operation 必须归零`)
  }

  await verifyDestroyedObjectUrlFailure({
    failureScenario: 'object-url-reject',
    tradeRecord: rejectedObjectUrlTrade,
    started: rejectedObjectUrlStarted.promise,
    settle: () => rejectObjectUrl.reject(new Error('getAssetObjectUrl rejected')),
    expectedAssetId: 'asset-after-object-url-reject',
    label: 'Object URL reject',
  })

  await verifyDestroyedObjectUrlFailure({
    failureScenario: 'object-url-null',
    tradeRecord: nullObjectUrlTrade,
    started: nullObjectUrlStarted.promise,
    settle: () => allowNullObjectUrl.resolve(null),
    expectedAssetId: 'asset-after-object-url-null',
    label: 'Object URL null',
  })

  scenario = 'two-editors'
  const twoEditorContainer = document.createElement('div')
  document.body.append(twoEditorContainer)
  const twoEditorRoot = createRoot(twoEditorContainer)
  const firstChanges: string[] = []
  const secondChanges: string[] = []
  flushSync(() => {
    twoEditorRoot.render(
      <div>
        <section data-editor="first">
          <Editor content="<p>第一编辑器</p>" onChange={(html) => firstChanges.push(html)} />
        </section>
        <section data-editor="second">
          <Editor content="<p>第二编辑器</p>" onChange={(html) => secondChanges.push(html)} />
        </section>
      </div>,
    )
  })
  const firstEditorDom = twoEditorContainer.querySelector<HTMLElement>('[data-editor="first"] .ProseMirror')
  const secondEditorDom = twoEditorContainer.querySelector<HTMLElement>('[data-editor="second"] .ProseMirror')
  assert(firstEditorDom && secondEditorDom, '双 Editor 回归必须同时挂载两个真实 ProseMirror')
  const firstTiptap = (firstEditorDom as HTMLElement & { editor?: TiptapEditor }).editor
  const secondTiptap = (secondEditorDom as HTMLElement & { editor?: TiptapEditor }).editor
  assert(firstTiptap && secondTiptap, '双 Editor DOM 必须暴露各自 TipTap 实例')

  dispatchImagePaste(firstEditorDom)
  await waitForPendingStorageOperations()
  assert(firstEditorDom.querySelectorAll('img').length === 1, '第一 Editor 的粘贴必须写回第一 Editor')
  assert(secondEditorDom.querySelectorAll('img').length === 0, '模块级 bridge 不得把粘贴串写到第二 Editor')
  assert(firstChanges.length > 0, '第一 Editor 必须为自己的图片插入发出 onChange')
  assert(secondChanges.length === 0, '第二 Editor 不得因第一 Editor 粘贴而发出 onChange')
  firstTiptap.destroy()
  secondTiptap.destroy()
  twoEditorContainer.remove()

  resetNoteDraftsForTests()
  Reflect.deleteProperty(window, 'journalBridge')
}

declare global {
  interface Window {
    __editorImagePersistenceTest?: Promise<void>
  }
}

window.__editorImagePersistenceTest = run()

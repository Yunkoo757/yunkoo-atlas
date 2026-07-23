import { createRoot } from 'react-dom/client'
import { DataSettingsPanel } from '@/views/settings/DataSettingsPanel'
import { createQuickNote } from '@/data/quickNotes'
import { bootstrapStorage, getStorage } from '@/storage'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { pickPersisted } from '@/storage/persist'
import { StorageRevisionConflictError } from '@/storage/adapter'

declare global {
  interface Window {
    __dataSettingsAssetInventoryTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 8_000
  while (performance.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  await bootstrapStorage()
  const storage = getStorage()
  const originalListAssetRecords = storage.listAssetRecords
  const originalPreviewAssetPurge = storage.previewAssetPurge
  const originalCommitAssetPurge = storage.commitAssetPurge
  const originalPrepareAssetPurgeRecovery = storage.prepareAssetPurgeRecovery
  const originalCancelAssetPurge = storage.cancelAssetPurge
  let previewCalls = 0
  let commitCalls = 0
  let prepareCalls = 0
  let cancelCalls = 0
  const quickAssetId = await storage.saveAsset(new Blob(['abc'], { type: 'image/png' }), 'image/png')
  const note = createQuickNote(new Date('2026-07-22T08:00:00.000Z'))
  useStore.setState({
    trades: [],
    weeklyReviews: [],
    quickNotes: [{ ...note, contentHtml: `<img src="journal-asset://${quickAssetId}">` }],
  })
  storage.listAssetRecords = async () => [
    { id: quickAssetId, state: 'healthy', source: 'committed', actualBytes: 3 },
    { id: 'orphan-only', state: 'healthy', source: 'committed', actualBytes: 4 },
    { id: 'bad name!.png', state: 'foreign', source: 'filesystem', actualBytes: 5 },
    { id: '.prepared.tmp', state: 'temp', source: 'filesystem', actualBytes: 6 },
  ]
  storage.previewAssetPurge = async () => {
    previewCalls += 1
    return {
      operationId: `dry-run-operation-${previewCalls}`,
      revision: 7,
      candidateIds: ['orphan-only'],
      totalBytes: 4,
    }
  }
  storage.prepareAssetPurgeRecovery = async () => {
    prepareCalls += 1
    const live = await storage.getAssetForExport(quickAssetId)
    if (!live) throw new Error('missing live fixture asset')
    return {
      authorization: `authorization-${prepareCalls}`,
      webArchive: {
        snapshot: pickPersisted(useStore.getState(), useShortcutStore.getState().bindings),
        assets: [live, { id: 'orphan-only', mime: 'image/png', data: btoa('orph') }],
        recoveryOrphanAssetIds: ['orphan-only'],
      },
    }
  }
  storage.cancelAssetPurge = async () => { cancelCalls += 1 }
  storage.commitAssetPurge = async () => {
    commitCalls += 1
    if (commitCalls === 1) throw new StorageRevisionConflictError(7, 8)
    return { revision: 8, deletedIds: ['orphan-only'] }
  }

  const container = document.getElementById('root')!
  const root = createRoot(container)
  try {
    root.render(<DataSettingsPanel assetPurgeCommitEnabled />)
    await waitFor(() => container.textContent?.includes('1 张 · 3 B') === true, 'QuickNote-only 附件未计入健康清单')
    assert(container.textContent?.includes('1 张当前库孤立附件'), '孤立附件未展示')
    assert(container.textContent?.includes('1 个未知或非法附件项'), 'foreign 未展示')
    assert(container.textContent?.includes('1 个未完成临时附件'), 'temp 未展示')

    const previewButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('预览永久清理'))
    assert(previewButton, '存在 orphan 时必须提供 dry-run 入口')
    previewButton.click()
    await waitFor(() => document.body.textContent?.includes('永久清理当前库孤立附件') === true, 'dry-run 弹窗未打开')
    assert(Number(previewCalls) === 1, '打开清理确认前必须只执行一次真实 preview')
    assert(document.body.textContent?.includes('历史备份不会被扫描或修改'), 'UI 必须明确历史备份不在清理范围')
    assert(document.body.textContent?.includes('预览 revision：7'), 'UI 必须展示绑定提交的 preview revision')
    assert(document.body.textContent?.includes('先导出恢复归档'), '永久删除前必须提供恢复归档入口')
    const deleteButton = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('永久删除候选附件')) as HTMLButtonElement | undefined
    assert(deleteButton?.disabled, '未导出归档时永久删除必须禁用')
    const archiveButton = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('先导出恢复归档'))
    assert(archiveButton, '缺少恢复归档动作')
    archiveButton.click()
    await waitFor(() => document.body.textContent?.includes('恢复归档已导出') === true, '成功恢复归档未解锁确认流程')
    assert(Number(previewCalls) === 2, '归档前必须在最后一次 flush 后重新生成 preview')
    assert(Number(commitCalls) === 0 && deleteButton.disabled, '已归档但未人工确认时必须零提交')
    const checkbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')
    assert(checkbox && !checkbox.disabled, '成功归档后必须允许人工确认')
    checkbox.click()
    await waitFor(() => !deleteButton.disabled, '人工确认后提交按钮未解锁')
    deleteButton.click()
    await waitFor(() => !document.body.textContent?.includes('永久清理当前库孤立附件'), 'stale commit 后必须丢弃 modal/preview')
    assert(Number(commitCalls) === 1 && cancelCalls >= 1, 'stale commit 必须取消旧 preview/authorization')

    const reopenPreview = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('预览永久清理'))
    assert(reopenPreview, 'stale 后必须能从完整 dry-run 流程重试')
    reopenPreview.click()
    await waitFor(() => document.body.textContent?.includes('永久清理当前库孤立附件') === true, 'dry-run 重试未打开')
    const retryArchive = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('先导出恢复归档'))
    assert(retryArchive, '重新预览后必须重新归档')
    retryArchive.click()
    await waitFor(() => document.body.textContent?.includes('恢复归档已导出') === true, '重试归档未成功')
    const retryCheckbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')
    retryCheckbox?.click()
    const retryDelete = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('永久删除候选附件')) as HTMLButtonElement | undefined
    await waitFor(() => retryDelete?.disabled === false, '重试确认未解锁')
    retryDelete!.click()
    await waitFor(() => !document.body.textContent?.includes('永久清理当前库孤立附件'), '成功提交后 modal 未关闭')
    assert(Number(commitCalls) === 2 && Number(prepareCalls) === 2, 'stale 后必须重新归档授权才能成功提交')

    const cancelCallsBefore = cancelCalls
    reopenPreview.click()
    await waitFor(() => document.body.textContent?.includes('永久清理当前库孤立附件') === true, '取消场景未打开')
    const cancelButton = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === '取消')
    assert(cancelButton, 'dry-run 必须可取消')
    cancelButton.click()
    await waitFor(() => !document.body.textContent?.includes('永久清理当前库孤立附件'), '取消后必须关闭 dry-run')
    assert(Number(commitCalls) === 2 && cancelCalls === cancelCallsBefore + 1, '取消 dry-run 必须零写入并撤销 adapter preview')

    storage.listAssetRecords = async () => { throw new Error('inventory unavailable') }
    const refresh = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('刷新检查'))
    assert(refresh, '缺少刷新检查按钮')
    refresh.click()
    await waitFor(
      () => container.querySelector('[role="alert"]')?.textContent?.includes('inventory unavailable') === true,
      'inventory 失败必须进入可见错误状态',
    )
    assert(!container.textContent?.includes('0 张 · 0 B'), 'inventory 失败不得伪装成全零健康结果')
  } finally {
    root.unmount()
    storage.listAssetRecords = originalListAssetRecords
    storage.previewAssetPurge = originalPreviewAssetPurge
    storage.commitAssetPurge = originalCommitAssetPurge
    storage.prepareAssetPurgeRecovery = originalPrepareAssetPurgeRecovery
    storage.cancelAssetPurge = originalCancelAssetPurge
  }
}

window.__dataSettingsAssetInventoryTest = run()

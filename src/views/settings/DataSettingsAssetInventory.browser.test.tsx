import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
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
    root.render(<MemoryRouter><DataSettingsPanel /></MemoryRouter>)
    await waitFor(() => container.textContent?.includes('1 张图片 · 3 B') === true, 'QuickNote-only 附件未计入资料概况')
    assert(!container.querySelector('[data-stage-ownership-health-entry]'), '没有待整理记录时不应常驻显示 0 项状态')
    const stageEntry = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '开启新实盘阶段')
    assert(stageEntry, '数据设置必须提供统一的开启新实盘阶段入口')
    assert(!container.textContent?.includes('风险数据起算日'), '数据设置不得继续暴露任意起算日选择作为正常入口')
    stageEntry.click()
    await waitFor(() => Boolean(document.querySelector('[data-live-stage-manager]')), '数据设置阶段入口必须打开预约对话框')
    const closeStageManager = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '关闭')
    assert(closeStageManager, '阶段管理弹窗必须可关闭')
    closeStageManager.click()
    await waitFor(() => !document.querySelector('[data-live-stage-manager]'), '阶段管理弹窗关闭失败')
    assert(container.textContent?.includes('1 张未被引用'), '孤立附件未展示')
    assert(container.textContent?.includes('1 个未知项'), 'foreign 未展示')
    assert(container.textContent?.includes('1 个临时项'), 'temp 未展示')

    const previewButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('清理孤立附件'))
    assert(previewButton, '存在 orphan 时必须提供清理预览入口')
    previewButton.click()
    await waitFor(() => document.body.textContent?.includes('数据版本：7') === true, '默认完整清理确认弹窗未打开')
    assert(Number(previewCalls) === 1, '打开清理确认前必须只执行一次真实 preview')
    assert(document.body.textContent?.includes('历史备份不会被扫描或修改'), 'UI 必须明确历史备份不在清理范围')
    assert(document.body.textContent?.includes('数据版本：7'), 'UI 必须展示绑定提交的数据版本')
    assert(document.body.textContent?.includes('导出恢复归档（可选）'), '必须保留可选的恢复归档入口')
    const deleteButton = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('确认永久清理')) as HTMLButtonElement | undefined
    const checkbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')
    assert(checkbox && !checkbox.disabled, '预览完成后必须允许用户直接确认，不得强制导出归档')
    assert(deleteButton?.disabled, '未人工确认时永久删除必须禁用')
    checkbox.click()
    await waitFor(() => !deleteButton.disabled, '人工确认后提交按钮未解锁')
    deleteButton.click()
    await waitFor(() => !document.body.textContent?.includes('数据版本：7'), 'stale commit 后必须丢弃 modal/preview')
    assert(Number(commitCalls) === 1 && Number(prepareCalls) === 0 && cancelCalls >= 1, '不导出归档也必须提交；stale 时取消旧 preview')

    const reopenPreview = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('清理孤立附件'))
    assert(reopenPreview, 'stale 后必须能从完整预览流程重试')
    reopenPreview.click()
    await waitFor(() => document.body.textContent?.includes('数据版本：7') === true, '清理确认重试未打开')
    const retryCheckbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')
    retryCheckbox?.click()
    const retryDelete = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('确认永久清理')) as HTMLButtonElement | undefined
    await waitFor(() => retryDelete?.disabled === false, '重试确认未解锁')
    retryDelete!.click()
    await waitFor(() => !document.body.textContent?.includes('数据版本：7'), '成功提交后 modal 未关闭')
    assert(Number(commitCalls) === 2 && Number(prepareCalls) === 0, 'stale 后重新预览确认即可成功提交')

    const cancelCallsBefore = cancelCalls
    reopenPreview.click()
    await waitFor(() => document.body.textContent?.includes('数据版本：7') === true, '取消场景未打开')
    const archiveButton = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('导出恢复归档（可选）'))
    assert(archiveButton, '缺少可选恢复归档动作')
    archiveButton.click()
    await waitFor(() => document.body.textContent?.includes('恢复归档已导出') === true, '用户主动导出恢复归档未成功')
    assert(Number(prepareCalls) === 1, '恢复归档只应在用户主动选择时生成')
    const cancelButton = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === '取消')
    assert(cancelButton, '开闸模式必须可取消')
    cancelButton.click()
    await waitFor(() => !document.body.textContent?.includes('数据版本：7'), '取消后必须关闭弹窗')
    assert(Number(commitCalls) === 2 && cancelCalls >= cancelCallsBefore + 2, '取消预览必须零写入并撤销归档前后的 adapter preview')

    // 默认未开闸：只展示预览与导出，不出现永久删除主 CTA
    root.render(<MemoryRouter><DataSettingsPanel assetPurgeCommitEnabled={false} /></MemoryRouter>)
    await waitFor(
      () => container.textContent?.includes('当前已关闭永久清理') === true,
      '显式关闭时必须说明只保留预览与恢复归档',
    )
    assert(container.textContent?.includes('清理孤立附件') === true, '显式关闭时仍须提供清理入口')
    const dryRunPreview = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('清理孤立附件'))
    assert(dryRunPreview, '未开闸时仍须提供预览入口')
    dryRunPreview.click()
    await waitFor(() => document.body.textContent?.includes('当前永久清理已关闭') === true, '显式关闭时预览弹窗未打开')
    assert(!document.body.textContent?.includes('确认永久清理'), '显式关闭时不得渲染永久清理主按钮')
    assert(!document.body.textContent?.includes('观察期'), '未开闸文案不得出现观察期黑话')
    assert(document.body.textContent?.includes('导出恢复归档'), '未开闸主操作应为导出恢复归档')
    const dryRunClose = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === '关闭')
    assert(dryRunClose, '未开闸弹窗须提供关闭')
    dryRunClose.click()
    await waitFor(() => !document.body.textContent?.includes('当前永久清理已关闭'), '关闭预览后弹窗未消失')
    storage.listAssetRecords = async () => { throw new Error('inventory unavailable') }
    const refresh = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === '刷新')
    assert(refresh, '缺少刷新资料概况按钮')
    refresh.click()
    await waitFor(
      () => container.querySelector('[role="alert"]')?.textContent?.includes('暂时无法读取存储健康信息') === true,
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

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
  const commitAuthorizations: Array<string | undefined> = []
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
  const canceledIds = new Set<string>()
  storage.cancelAssetPurge = async id => { cancelCalls += 1; canceledIds.add(id) }
  storage.commitAssetPurge = async (_preview, authorization) => {
    commitAuthorizations.push(authorization)
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
    const findAction = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text)
    assert(findAction('导出恢复归档（可选）'), '恢复归档必须明确为可选操作')
    assert(!document.querySelector('.data-purge-body input[type="checkbox"]'), '单次确认弹窗不再额外要求勾选')
    const deleteButton = findAction('确认永久清理')
    assert(deleteButton && !deleteButton.disabled, '完成预览后必须能直接确认，无需导出归档')
    deleteButton.click()
    await waitFor(() => !document.body.textContent?.includes('数据版本：7'), 'stale commit 后必须丢弃旧预览')
    assert(Number(commitCalls) === 1 && Number(prepareCalls) === 0 && cancelCalls >= 1, '直接确认不应导出归档，stale 后仍要重新预览')
    assert(commitAuthorizations[0] === undefined, '直接清理必须向后端省略可选授权')

    const reopenPreview = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('清理孤立附件'))!
    reopenPreview.click()
    await waitFor(() => Boolean(findAction('确认永久清理')), '清理重试未打开')
    findAction('确认永久清理')!.click()
    await waitFor(() => !document.body.textContent?.includes('数据版本：7'), '成功清理后弹窗未关闭')
    assert(Number(commitCalls) === 2 && Number(prepareCalls) === 0, '重新预览后可直接确认成功，不强制生成恢复归档')

    const cancelCallsBefore = cancelCalls
    reopenPreview.click()
    await waitFor(() => Boolean(findAction('导出恢复归档（可选）')), '手动导出场景未打开')
    const archiveButton = findAction('导出恢复归档（可选）')!
    assert(!archiveButton.classList.contains('ui-btn-primary'), '清理可用时，可选导出不应抢占主操作')
    archiveButton.click()
    await waitFor(() => Boolean(findAction('恢复归档已导出')), '可选恢复归档未成功导出')
    assert(Number(prepareCalls) === 1 && !findAction('确认永久清理')?.disabled, '导出成功后不应额外要求勾选确认')
    findAction('取消')!.click()
    await waitFor(() => !document.body.textContent?.includes('数据版本：7'), '取消后必须关闭弹窗')
    await waitFor(() => document.activeElement === reopenPreview, '关闭清理弹窗后焦点必须回到扫描入口')
    assert(Number(commitCalls) === 2 && cancelCalls >= cancelCallsBefore + 2, '取消只消费预览，不执行清理')

    const successfulPrepare = storage.prepareAssetPurgeRecovery
    let canceledExportStarted = false
    storage.prepareAssetPurgeRecovery = async () => { canceledExportStarted = true; throw new Error('恢复归档导出已取消') }
    reopenPreview.click()
    await waitFor(() => Boolean(findAction('导出恢复归档（可选）')), '取消导出场景未打开')
    const recoveryAction = findAction('导出恢复归档（可选）')!
    recoveryAction.click()
    await waitFor(() => canceledExportStarted && !findAction('确认永久清理')?.disabled && !recoveryAction.disabled, '取消导出后必须可重试并允许直接清理')
    assert(!findAction('确认永久清理')?.disabled, '取消可选导出不能阻止直接清理')
    assert(!document.body.textContent?.includes('恢复归档导出失败'), '取消保存不应报错')
    storage.prepareAssetPurgeRecovery = async () => { throw new Error('测试：磁盘空间不足') }
    recoveryAction.click()
    await waitFor(() => document.body.textContent?.includes('恢复归档导出失败') === true, '导出失败应保留可见提示')
    assert(!findAction('确认永久清理')?.disabled, '导出失败也不应成为清理的前置门槛')
    findAction('确认永久清理')!.click()
    await waitFor(() => !document.body.textContent?.includes('数据版本：7'), '可选导出失败后仍应能直接完成清理')
    assert(Number(commitCalls) === 3 && commitAuthorizations[2] === undefined, '可选导出失败后必须省略授权直接提交')
    storage.prepareAssetPurgeRecovery = successfulPrepare

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
    // 模拟从设置页离开。卸载发生在扫描或导出等待时，迟到的结果也不能成为新页面的预览。
    const renderSettings = () => root.render(<MemoryRouter><DataSettingsPanel /></MemoryRouter>)
    const leave = async () => {
      root.render(<div>其他页面</div>)
      await waitFor(() => container.textContent === '其他页面', '未离开数据设置')
    }
    const scanFromSettings = async () => {
      renderSettings()
      await waitFor(() => Boolean(findAction('清理孤立附件')), '重进设置后没有清理入口')
      findAction('清理孤立附件')!.click()
    }
    const scan = storage.previewAssetPurge!
    const originalClick = HTMLAnchorElement.prototype.click
    let downloads = 0
    try {
      await scanFromSettings()
      await waitFor(() => Boolean(findAction('确认永久清理')), '离页前没有显示预览')
      const displayedId = `dry-run-operation-${previewCalls}`
      await leave()
      await waitFor(() => canceledIds.has(displayedId), '设置页卸载后显示中的预览仍被保留')

      let releaseScan: (() => void) | undefined
      storage.previewAssetPurge = async () => {
        await new Promise<void>(resolve => { releaseScan = resolve })
        return scan()
      }
      await scanFromSettings()
      await waitFor(() => !!releaseScan, '没有进入等待中的扫描')
      await leave()
      const lateId = `dry-run-operation-${previewCalls + 1}`
      releaseScan!()
      await waitFor(() => canceledIds.has(lateId), '页面离开后返回的预览没有被撤销')
      storage.previewAssetPurge = scan

      HTMLAnchorElement.prototype.click = () => { downloads++ }
      let returned = false
      let releaseExport: (() => void) | undefined
      storage.prepareAssetPurgeRecovery = async preview => {
        await new Promise<void>(resolve => { releaseExport = resolve })
        try { return await successfulPrepare(preview) } finally { returned = true }
      }
      await scanFromSettings()
      await waitFor(() => Boolean(findAction('导出恢复归档（可选）')), '导出等待场景未打开')
      const originalId = `dry-run-operation-${previewCalls}`
      findAction('导出恢复归档（可选）')!.click()
      await waitFor(() => !!releaseExport, '没有进入等待中的导出')
      const refreshedId = `dry-run-operation-${previewCalls}`
      assert(originalId !== refreshedId, '导出必须持有自己的重新扫描结果')
      await leave()
      await waitFor(() => canceledIds.has(originalId) && canceledIds.has(refreshedId), '卸载必须释放显示中及导出中的预览')
      // 让旧导出在新页面已挂载后返回，验证下载及弹窗都属于原页面。
      renderSettings()
      await waitFor(() => Boolean(findAction('清理孤立附件')), '新设置页未挂载')
      releaseExport!()
      await waitFor(() => returned, '后台导出未回到调用方')
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      assert(downloads === 0 && !findAction('恢复归档已导出'), '已离开的页面不得下载迟到的恢复归档')
    } finally {
      HTMLAnchorElement.prototype.click = originalClick
      storage.previewAssetPurge = scan
      storage.prepareAssetPurgeRecovery = successfulPrepare
    }
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

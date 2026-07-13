import fs from 'node:fs/promises'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testExplicitSaveFailuresPropagateAndCancelWindowClose(): Promise<void> {
  const [persist, preload, main, updater] = await Promise.all([
    fs.readFile('src/storage/persist.ts', 'utf8'),
    fs.readFile('electron/preload.ts', 'utf8'),
    fs.readFile('electron/main.ts', 'utf8'),
    fs.readFile('electron/updater.ts', 'utf8'),
  ])
  assert(persist.includes('throw e'), '显式写盘失败必须向调用方抛出')
  assert(!persist.includes('不回滚——尽力而为'), '关闭前草稿归一化失败不得被吞掉')
  assert(preload.includes("ok: false"), '预加载桥应把关闭前保存失败回传主进程')
  assert(main.includes("app:close-save-error"), '主进程应通知渲染层关闭已被取消')
  assert(main.includes('15_000'), '慢速图片写盘应获得充足等待时间')
  assert(updater.includes("result?.ok === false"), '安装更新前也必须等待并检查保存结果')
  assert(!updater.includes('quitAndInstall(false, true), 500'), '更新安装不得在固定 500ms 后强制退出')
}

export async function testBootstrapFailureCannotExposeAnUnsavableWorkspace(): Promise<void> {
  const app = await fs.readFile('src/App.tsx', 'utf8')
  assert(app.includes('setStorageError'), '资料库启动失败必须进入显式错误状态')
  assert(app.includes('已停止进入工作区，避免覆盖现有数据'), '错误页应说明数据保护原因')
  assert(!app.includes("setReady(true)\n      document.documentElement.dataset.uiSettled = '1'"), '启动失败不得继续显示普通工作区')
}

export async function testAttachmentPreviewCachesAreBoundedAndInvalidatedOnImport(): Promise<void> {
  const [indexedDb, electron, importExport] = await Promise.all([
    fs.readFile('src/storage/indexedDbAdapter.ts', 'utf8'),
    fs.readFile('src/storage/electronAdapter.ts', 'utf8'),
    fs.readFile('src/lib/importExport.ts', 'utf8'),
  ])
  for (const [name, source] of [['IndexedDB', indexedDb], ['Electron', electron]] as const) {
    assert(source.includes('MAX_OBJECT_URL_CACHE = 128'), `${name} 图片预览缓存必须有上限`)
    assert(source.includes('URL.revokeObjectURL'), `${name} 淘汰预览时必须释放 Blob URL`)
    assert(source.includes('this.objectUrlCache.delete(asset.id)'), `${name} 导入同 ID 图片时必须失效旧缓存`)
  }
  assert(
    importExport.includes('getElectronAdapter().clearObjectUrlCache()'),
    '整库导入后必须清除桌面附件预览缓存',
  )
}

export async function testStorageHealthOnlyReportsMeasuredAttachmentData(): Promise<void> {
  const panel = await fs.readFile('src/views/settings/DataSettingsPanel.tsx', 'utf8')
  assert(!panel.includes('orphanedCount: 0'), '存储健康不得把未执行的孤立附件扫描报告为零')
  assert(!panel.includes('const stats: AssetStats'), '存储健康不得保留未使用的伪统计结果')
  assert(
    panel.includes('attachmentStats: { count, totalBytes'),
    '图片数量与容量必须来自实际读取成功的附件',
  )
}

import fs from 'node:fs/promises'
import { haveSamePersistedReferences } from '@/storage/bootstrap'
import type { PersistedSnapshot } from '@/storage/types'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testExplicitSaveFailuresPropagateAndCancelWindowClose(): Promise<void> {
  const [persist, preload, main, updater, coordinator, app] = await Promise.all([
    fs.readFile('src/storage/persist.ts', 'utf8'),
    fs.readFile('electron/preload.ts', 'utf8'),
    fs.readFile('electron/main.ts', 'utf8'),
    fs.readFile('electron/updater.ts', 'utf8'),
    fs.readFile('electron/quitCoordinator.ts', 'utf8'),
    fs.readFile('src/App.tsx', 'utf8'),
  ])
  assert(persist.includes('throw e'), '显式写盘失败必须向调用方抛出')
  assert(!persist.includes('不回滚——尽力而为'), '关闭前草稿归一化失败不得被吞掉')
  assert(preload.includes("ok: false"), '预加载桥应把关闭前保存失败回传主进程')
  assert(main.includes("app:close-save-error"), '主进程应通知渲染层关闭已被取消')
  assert(main.includes('15_000'), '慢速图片写盘应获得充足等待时间')
  assert(app.includes('正在安全保存…'), '退出时必须明确显示正在保存')
  assert(app.includes('已安全保存'), '关闭窗口前必须给出保存成功回执')
  assert(app.includes('保存未完成，已取消退出'), '保存失败时必须明确说明窗口不会关闭')
  assert(app.includes('CLOSE_SAVE_RECEIPT_MS'), '成功回执必须保留可感知的展示时间')
  assert(app.includes('lockBottomChrome()'), '关闭回执出现时必须锁定底部通知层，避免与 toast 重叠')
  assert(
    !/onCloseSaveError\([\s\S]*toast\(/.test(app),
    '关闭保存失败回执不得再额外 toast，避免双条重叠',
  )
  assert(
    !(await fs.readFile('src/views/settings/UpdatesSettingsPanel.tsx', 'utf8')).includes(
      '备份已验证，正在重启安装更新',
    ),
    '安装更新不得再弹与关闭回执抢位的 toast',
  )
  assert(preload.includes('removeListener'), '关闭前回调必须可取消订阅，避免重复监听叠出多条回执')
  assert(preload.includes('requestClose'), '保存失败后必须提供可重试的退出入口')
  assert(
    updater.includes("await requestExit('quit-and-install')") &&
      coordinator.includes('requestRendererFlush'),
    '安装更新前也必须通过统一协调器等待并检查保存结果',
  )
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
    assert(
      /this\.objectUrlCache\.delete\((?:asset|record)\.id\)/.test(source),
      `${name} 导入同 ID 图片时必须失效旧缓存`,
    )
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
    panel.includes('const storage = await checkStorageHealth()'),
    '存储健康必须使用真实物理清单与引用分类',
  )
  assert(panel.includes('role="alert"'), '附件清单失败必须显示可见错误，不能回落到全零')
  assert(panel.includes('inventory.orphan.length'), '设置页必须展示当前库孤立附件')
  assert(panel.includes('inventory.foreign.length'), '设置页必须展示未知或非法附件项')
  assert(panel.includes('inventory.temp.length'), '设置页必须展示未完成临时附件')
  assert(!panel.includes('getAssetForExport(id)'), '存储健康统计不得读取图片正文或生成 Base64')
}

export async function testLibraryLocationConfigUsesAtomicPersistence(): Promise<void> {
  const paths = await fs.readFile('electron/library/paths.ts', 'utf8')
  assert(paths.includes("import { writeFileAtomicallySync } from './atomicFile'"), '资料库路径配置应复用原子写入')
  assert(
    paths.includes('writeFileAtomicallySync(getConfigPath(), JSON.stringify(cfg, null, 2)'),
    '切换资料库后不得直接覆盖路径配置文件',
  )
  assert(!paths.includes('fs.writeFileSync(getConfigPath()'), '资料库路径配置不得存在中断后半写文件风险')
}

export async function testUserDataStorageHasNoCloudSyncSurfaceOrRuntime(): Promise<void> {
  const [dataSettings, welcome, app, storage, ipc, qa, settingsLayout] = await Promise.all([
    fs.readFile('src/components/DataIOContent.tsx', 'utf8'),
    fs.readFile('src/components/WelcomeScreen.tsx', 'utf8'),
    fs.readFile('src/App.tsx', 'utf8'),
    fs.readFile('electron/library/storage.ts', 'utf8'),
    fs.readFile('electron/library/ipc.ts', 'utf8'),
    fs.readFile('electron/qa.ts', 'utf8'),
    fs.readFile('src/views/settings/SettingsLayout.tsx', 'utf8'),
  ])
  const productSources = [dataSettings, welcome, app, storage, ipc, qa, settingsLayout].join('\n')
  for (const forbidden of ['iCloud', 'OneDrive', '云盘', '云同步', '云端数据']) {
    assert(!productSources.includes(forbidden), `产品不得保留用户数据云同步语境：${forbidden}`)
  }
  assert(!storage.includes('findIcloudConflictDbCandidate'), '本地存储不得保留云盘冲突副本恢复实现')
  assert(!app.includes('/settings/sync'), '设置中不得保留云同步入口')
  assert(dataSettings.includes('本机磁盘'), '数据设置必须明确资料库保存在本机磁盘')
  assert(welcome.includes('定期创建完整备份'), '首次建库必须给出本地备份建议')
}

export async function testBackupRestoreValidatesDatabaseBeforeMutatingCurrentLibrary(): Promise<void> {
  const ipc = await fs.readFile('electron/library/ipc.ts', 'utf8')
  const restoreHandler = ipc.indexOf("ipcMain.handle('backup:restore'")
  const storageValidation = ipc.indexOf('const current = await ensureStorage()', restoreHandler)
  const validation = ipc.indexOf('const verification = await verifyBackupAtPath(libraryPath, fileName)', storageValidation)
  const rejection = ipc.indexOf("if (verification.status !== 'verified') return false", validation)
  const safetyBackup = ipc.indexOf('if (!createBackup(current)) return false', rejection)
  assert(storageValidation >= 0 && storageValidation < validation, '恢复前必须先取得通过位置状态机验证的活动库')
  assert(validation >= 0 && rejection > validation, '恢复点必须先通过完整恢复演练')
  assert(safetyBackup > rejection, '校验失败时不得创建安全备份、关闭或替换当前资料库')
  assert(
    !ipc.includes('void verifyBackup(path.basename(result)).catch'),
    '退出前创建恢复点不得启动同步附件校验并阻塞主进程',
  )
  const app = await fs.readFile('src/App.tsx', 'utf8')
  const closeHandler = app.slice(app.indexOf('bridge.onBeforeClose'), app.indexOf('bridge.onCloseSaveError'))
  assert(!closeHandler.includes('createBackup'), '窗口 15 秒关闭握手只负责落盘，不得同步处理整库附件')
}

export async function testRouteLazyChunksAreNotForcedIntoInitialManualChunks(): Promise<void> {
  const viteConfig = await fs.readFile('vite.config.ts', 'utf8')
  assert(!viteConfig.includes('manualChunks'), '路由懒加载依赖不得被手工分包重新拉入首屏')
  assert(!viteConfig.includes('editor-vendor'), '编辑器依赖必须随动态入口按需加载')
  assert(!viteConfig.includes('charts-vendor'), '图表依赖必须随动态入口按需加载')
}

export function testTransientUiStateDoesNotScheduleAFullSnapshotRewrite(): void {
  const base: PersistedSnapshot = {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: {
      hideClosed: false,
      showEmptyGroups: false,
      groupByStrategy: false,
      groupByDate: true,
      sortBy: 'date',
      privacyMode: false,
      tradingDayStartHour: 6,
      sidebarPins: [],
      sidebarWorkspaceItems: [],
    },
    tagPresets: [],
    mistakeTagPresets: [],
    profile: { avatarId: null, displayName: 'Yunkoo' },
    savedTradeViews: [],
    symbolIcons: {},
    symbolCatalog: [],
  }

  assert(
    haveSamePersistedReferences(base, { ...base, shortcuts: {} }),
    '主 store 的临时 UI 更新不得因 shortcuts 快照重建而触发写盘',
  )
  assert(
    !haveSamePersistedReferences(base, { ...base, trades: [...base.trades] }),
    '持久化字段引用变化必须继续触发写盘',
  )
}

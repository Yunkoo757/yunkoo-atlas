import fs from 'node:fs/promises'
import { assertSafeAssetId, isSafeAssetId } from '@/storage/assetId'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testAttachmentIdsAcceptOnlyThePortableSafeSubset(): void {
  for (const id of ['asset-1', 'asset_2', 'A9', 'a'.repeat(128)]) {
    assert(isSafeAssetId(id), `合法附件 ID 应被接受：${id}`)
    assertSafeAssetId(id)
  }

  for (const id of [
    '',
    'a'.repeat(129),
    '../escape',
    '..\\escape',
    'nested/asset',
    'asset.png',
    '含中文',
    'with space',
  ]) {
    assert(!isSafeAssetId(id), `危险或不可移植的附件 ID 应被拒绝：${id}`)
    let rejected = false
    try {
      assertSafeAssetId(id)
    } catch {
      rejected = true
    }
    assert(rejected, `assertSafeAssetId 必须拒绝：${id}`)
  }
}

export async function testAttachmentImportAndDesktopInstanceSafetyAreWiredAtBoundaries(): Promise<void> {
  const [importExport, ipc, storage, main, windowPresence, windowPresenceTest] = await Promise.all([
    fs.readFile('src/lib/importExport.ts', 'utf8'),
    fs.readFile('electron/library/ipc.ts', 'utf8'),
    fs.readFile('electron/library/storage.ts', 'utf8'),
    fs.readFile('electron/main.ts', 'utf8'),
    fs.readFile('electron/windowPresence.ts', 'utf8'),
    fs.readFile('electron/windowPresence.test.ts', 'utf8'),
  ])

  assert(importExport.includes('isSafeAssetId(v.id)'), 'JSON 解析层必须拒绝危险附件 ID')
  assert(ipc.includes('assertSafeAssetId(a.id)'), 'IPC 边界必须再次验证附件 ID')
  assert(storage.includes('assertSafeAssetId(id)'), '存储层必须独立验证附件 ID')
  assert(storage.includes('path.relative(resolvedRoot, resolvedTarget)'), '附件落盘前必须验证目标仍在附件目录内')

  assert(main.includes('app.requestSingleInstanceLock()'), '桌面端必须申请单实例锁')
  assert(
    main.includes("process.env.TRADER_ATLAS_QA === '1' || forcedKillMode || app.requestSingleInstanceLock()"),
    '桌面 QA 必须绕过日常客户端的单实例锁，避免发布门禁被正在运行的客户端误拦截',
  )
  assert(
    main.includes('const forcedKillMode = process.env.TRADER_ATLAS_FORCED_KILL_MODE'),
    '强杀证据的 Electron 主进程必须显式绕过单实例锁',
  )
  assert(main.includes("app.on('second-instance'"), '主实例必须处理第二实例启动事件')
  const secondInstance = main.slice(
    main.indexOf("app.on('second-instance'"),
    main.indexOf('app.whenReady()'),
  )
  assert(secondInstance.includes('windowPresence?.show()'), '第二实例启动必须委托常驻控制器显示窗口')
  const controllerStart = windowPresence.indexOf('export class WindowPresenceController')
  const showStart = windowPresence.indexOf('  show(): void', controllerStart)
  const showImplementation = windowPresence.slice(
    showStart,
    windowPresence.indexOf('  hide(): void', showStart),
  )
  assert(
    showImplementation.includes('if (window.isMinimized()) window.restore()') &&
      showImplementation.includes('window.show()') &&
      showImplementation.includes('window.focus()'),
    '常驻控制器 show 必须恢复最小化窗口并显示、聚焦',
  )
  const minimizedBehaviorTest = windowPresenceTest.slice(
    windowPresenceTest.indexOf('export function testMinimizedWindowIsRestoredBeforeShowingAndFocusing'),
    windowPresenceTest.indexOf('export function testHiddenWindowIsShownAndFocused'),
  )
  assert(
    minimizedBehaviorTest.includes('minimized: true') &&
      minimizedBehaviorTest.includes(
        "'tray:create|window:restore|dock:show|window:show|window:focus'",
      ),
    '最小化窗口恢复行为必须有严格调用顺序的直接回归证据',
  )
}

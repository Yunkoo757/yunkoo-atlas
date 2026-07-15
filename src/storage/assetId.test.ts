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
  const [importExport, ipc, storage, main] = await Promise.all([
    fs.readFile('src/lib/importExport.ts', 'utf8'),
    fs.readFile('electron/library/ipc.ts', 'utf8'),
    fs.readFile('electron/library/storage.ts', 'utf8'),
    fs.readFile('electron/main.ts', 'utf8'),
  ])

  assert(importExport.includes('isSafeAssetId(v.id)'), 'JSON 解析层必须拒绝危险附件 ID')
  assert(ipc.includes('assertSafeAssetId(a.id)'), 'IPC 边界必须再次验证附件 ID')
  assert(storage.includes('assertSafeAssetId(id)'), '存储层必须独立验证附件 ID')
  assert(storage.includes('path.relative(resolvedRoot, resolvedTarget)'), '附件落盘前必须验证目标仍在附件目录内')

  assert(main.includes('app.requestSingleInstanceLock()'), '桌面端必须申请单实例锁')
  assert(main.includes("app.setPath('userData'"), '桌面 QA 必须使用隔离的用户数据目录')
  assert(main.includes('isHeadlessQa || app.requestSingleInstanceLock()'), '桌面 QA 不得被已运行客户端的单实例锁拦截')
  assert(main.includes("app.on('second-instance'"), '主实例必须处理第二实例启动事件')
  assert(main.includes('mainWindow.isMinimized()'), '第二实例启动时应恢复最小化窗口')
  assert(main.includes('mainWindow.focus()'), '第二实例启动时应聚焦现有窗口')
}

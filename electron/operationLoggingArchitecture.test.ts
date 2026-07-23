import fs from 'node:fs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testDurableElectronOperationsUseThePairedOperationLogger(): void {
  const ipc = fs.readFileSync('electron/library/ipc.ts', 'utf8')
  const main = fs.readFileSync('electron/main.ts', 'utf8')
  const webAdapter = fs.readFileSync('src/storage/indexedDbAdapter.ts', 'utf8')
  const webExports = fs.readFileSync('src/lib/importExport.ts', 'utf8')

  assert((ipc.match(/beginOperation\('archive'/g) ?? []).length >= 2, '归档与 GC 恢复归档必须使用成对操作日志')
  assert((ipc.match(/beginOperation\('import'/g) ?? []).length >= 2, '批次导入与桌面归档导入必须使用成对操作日志')
  assert((ipc.match(/beginOperation\('gc'/g) ?? []).length >= 1, '附件 GC 提交必须使用成对操作日志')
  assert(main.includes("beginOperation('quit'"), '正常退出必须使用成对操作日志')
  assert(main.includes('reportStart: reportExitStart'), 'QuitCoordinator 必须连接 start 日志')
  assert(main.includes('reportSuccess: reportExitSuccess'), 'QuitCoordinator 必须连接 success 日志')
  assert(main.includes('reportError: reportExitError'), 'QuitCoordinator 必须连接 failure 日志')
  assert((webAdapter.match(/beginWebOperation\('archive'/g) ?? []).length >= 2, 'Web 恢复归档与 GC 恢复点必须使用成对日志')
  assert(webAdapter.includes("beginWebOperation('import'"), 'Web import 必须使用成对日志')
  assert(webAdapter.includes("beginWebOperation('gc'"), 'Web GC 必须使用成对日志')
  assert((webExports.match(/beginWebOperation\('archive'/g) ?? []).length >= 2, 'Web JSON/ZIP 导出必须使用成对日志')
}

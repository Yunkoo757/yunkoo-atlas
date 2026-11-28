import fs from 'node:fs'
import path from 'node:path'
import electronRuntime from 'electron'
import initSqlJs from 'sql.js'

function locateFile(file: string): string {
  const resources = process.resourcesPath
  // Node 下的 electron 包导出可执行文件路径；客户端由 app 提供真实应用目录。
  const application = typeof electronRuntime === 'object' ? electronRuntime?.app?.getAppPath?.() : undefined
  const development = path.join(process.cwd(), 'node_modules/sql.js/dist', file)
  const candidates = [
    ...(resources ? [path.join(resources, file)] : []),
    ...(application ? [path.join(application, 'dist-electron', file), path.join(application, file)] : []),
    ...(resources ? [
      path.join(resources, 'app.asar', 'dist-electron', file),
      path.join(resources, 'app', 'dist-electron', file),
    ] : []),
    path.join(process.cwd(), 'dist-electron', file),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) ?? development
}

/** sql.js 缓存首次初始化的 Promise。所有桌面资料库入口须使用同一资源定位规则。 */
export function getLibrarySql() {
  return initSqlJs({ locateFile })
}

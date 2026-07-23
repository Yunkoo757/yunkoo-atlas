import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { sanitizeDiagnosticDetail } from './diagnosticSanitizer'

const MAX_LOG_BYTES = 2 * 1024 * 1024
let logFile: string | null = null

export function logDiagnostic(
  level: 'info' | 'warn' | 'error',
  event: string,
  detail?: unknown,
): void {
  if (!logFile) return
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(sanitizeDiagnosticDetail(detail))}`
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${level.toUpperCase()} ${event}${suffix}\n`, 'utf8')
  } catch {
    // 诊断日志不能影响主流程。
  }
}

export function initializeDiagnostics(): string {
  const directory = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(directory, { recursive: true })
  logFile = path.join(directory, 'main.log')

  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size >= MAX_LOG_BYTES) {
      fs.renameSync(logFile, path.join(directory, 'main.previous.log'))
    }
  } catch {
    // 无法轮转时继续追加，不阻止应用启动。
  }

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    logDiagnostic('error', `uncaught-exception:${origin}`, error)
  })
  process.on('unhandledRejection', (reason) => {
    logDiagnostic('error', 'unhandled-rejection', reason)
  })
  logDiagnostic('info', 'app-start', {
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  })
  return logFile
}

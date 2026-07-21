import { readFileSync } from 'node:fs'
import {
  normalizeUpdateCredential,
  redactUpdateError,
  reduceUpdateState,
  type AppUpdateState,
} from './appUpdate'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testUpdateLifecycleExposesStableUserFacingState() {
  const idle: AppUpdateState = {
    phase: 'idle',
    currentVersion: '1.0.0',
    availableVersion: null,
    progress: null,
    message: null,
  }

  const checking = reduceUpdateState(idle, { type: 'checking' })
  assert(checking.phase === 'checking', '手动检查后应进入 checking')

  const available = reduceUpdateState(checking, {
    type: 'available',
    version: '1.0.1',
  })
  assert(available.phase === 'available', '发现新版本后应进入 available')
  assert(available.availableVersion === '1.0.1', '应暴露可用版本号')

  const started = reduceUpdateState(available, { type: 'download-started' })
  assert(started.phase === 'downloading', '点击下载后应立刻进入 downloading')
  assert(started.progress === 0, '下载开始进度应为 0，避免按钮无反馈卡住')

  const downloading = reduceUpdateState(started, {
    type: 'progress',
    percent: 112.4,
  })
  assert(downloading.phase === 'downloading', '收到进度后应保持 downloading')
  assert(downloading.progress === 100, '下载进度必须限制在 100%')

  const downloaded = reduceUpdateState(downloading, {
    type: 'downloaded',
    version: '1.0.1',
  })
  assert(downloaded.phase === 'downloaded', '下载完成后应等待用户重启')
  assert(downloaded.progress === 100, '下载完成进度应为 100%')
}

export function testUpdateCredentialIsValidatedAndNeverLeakedInErrors() {
  const token = 'github_pat_1234567890abcdefghijklmnop'
  assert(normalizeUpdateCredential(`  ${token}  `) === token, '令牌应去除首尾空格')
  assert(normalizeUpdateCredential('short') === null, '过短令牌必须拒绝')
  assert(normalizeUpdateCredential('github token with spaces') === null, '包含空格的令牌必须拒绝')

  const message = redactUpdateError(`Request failed with token ${token}`)
  assert(!message.includes(token), '错误信息不得包含完整令牌')
  assert(message.includes('[credential]'), '错误信息应保留可诊断的脱敏标记')
}

export function testElectronUpdaterUsesCommonJsCompatibleRuntimeImport() {
  const source = readFileSync('electron/updater.ts', 'utf8')

  assert(
    !/import\s*\{[^}]*\bautoUpdater\b[^}]*\}\s*from\s*['"]electron-updater['"]/.test(source),
    'electron-updater 是 CommonJS 模块，不能在 Electron ESM 主进程中命名导入 autoUpdater',
  )
  assert(
    /import\s+\w+\s+from\s+['"]electron-updater['"]/.test(source),
    'electron-updater 运行时必须使用默认导入',
  )
}

export function testUpdaterReschedulesAfterCredentialChangesAndHandlesDownloadErrors() {
  const source = readFileSync('electron/updater.ts', 'utf8')
  const scheduleCalls = source.match(/scheduleAutomaticUpdateChecks\(\)/g) ?? []
  assert(scheduleCalls.length >= 3, '启动、保存令牌和清除令牌后都应重新配置自动检查计划')
  assert(source.includes('autoCheckDelayTimer'), '延迟检查必须可取消，避免重复计时器')
  assert(
    source.includes("await autoUpdater.downloadUpdate()") &&
      source.includes("message: redactUpdateError") &&
      source.includes("type: 'download-started'") &&
      source.includes('downloadInFlight'),
    '更新下载必须立刻进入 downloading，并防止重复触发导致卡住',
  )
}

export function testMacOsUpdaterClearlyUsesManualInstallation() {
  const source = readFileSync('electron/updater.ts', 'utf8')

  assert(
    source.includes("process.platform === 'darwin'"),
    'macOS 必须有独立的平台分支',
  )
  assert(
    source.includes('macOS 当前仅支持手动下载并安装新版本'),
    '未签名公证前不得暗示 macOS 支持应用内自动更新',
  )
}

export function testElectronWindowEnforcesNavigationAndCrashDiagnostics() {
  const main = readFileSync('electron/main.ts', 'utf8')
  const diagnostics = readFileSync('electron/diagnostics.ts', 'utf8')
  const html = readFileSync('index.html', 'utf8')

  assert(main.includes('sandbox: true'), '渲染窗口应启用 Chromium 沙箱')
  assert(main.includes("['https:', 'mailto:']"), '外部链接必须限制到安全协议')
  assert(main.includes("webContents.on('will-navigate'"), '必须阻止未授权页面跳转')
  assert(main.includes("webContents.on('render-process-gone'"), '必须记录渲染进程崩溃')
  assert(diagnostics.includes('uncaughtExceptionMonitor'), '必须记录主进程未捕获异常')
  assert(html.includes('Content-Security-Policy'), '渲染页面必须声明 CSP')
}

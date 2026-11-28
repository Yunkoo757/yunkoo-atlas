import { createRoot } from 'react-dom/client'
import type { AppUpdateState } from '@/lib/appUpdate'
import type { JournalBridge } from '@/types/journalBridge'
import { nextFrame, waitFor } from '@/test/browserTiming'
import { UpdatesSettingsPanel } from './UpdatesSettingsPanel'

declare global { interface Window { __updatesSettingsTest?: Promise<void> } }

async function run() {
  const previous = window.journalBridge
  const container = document.getElementById('root')!
  const root = createRoot(container)
  const calls: string[] = []
  const downloaded: AppUpdateState = {
    phase: 'downloaded', currentVersion: '1', availableVersion: '2', progress: 100, message: null,
  }
  const idle: AppUpdateState = { ...downloaded, phase: 'idle', availableVersion: null, progress: null }
  let finishRead!: (state: AppUpdateState) => void
  const initial = new Promise<AppUpdateState>(resolve => { finishRead = resolve })
  let broadcast: ((state: AppUpdateState) => void) | undefined
  window.journalBridge = {
    isElectron: true,
    getUpdateState: () => initial,
    onUpdateState: (receive: (state: AppUpdateState) => void) => {
      broadcast = receive
      return () => { broadcast = undefined }
    },
    createVerifiedBackup: async () => { calls.push('单独备份'); return { status: 'verified' } },
    installUpdate: async () => { calls.push('安装'); return true },
  } as unknown as JournalBridge
  try {
    root.render(<UpdatesSettingsPanel />)
    await waitFor(() => broadcast, '更新页没有订阅主进程状态')
    broadcast!(downloaded)
    await waitFor(() => container.querySelector('button')?.textContent?.includes('备份并重启更新'), '已下载更新缺少安装按钮')
    finishRead(idle)
    await nextFrame()
    await nextFrame()
    if (!container.querySelector('button')?.textContent?.includes('备份并重启更新')) {
      throw new Error('迟到的启动快照覆盖了已下载通知')
    }
    container.querySelector('button')!.click()
    await waitFor(() => calls.includes('安装'), '安装请求没有进入主进程')
    if (calls.join() !== '安装') throw new Error('设置页在关闭协调器之前单独创建了备份')
    root.render(<UpdatesSettingsPanel key="reopened" />)
    await waitFor(() => container.textContent?.includes('等待自动检查'), '没有新通知时应采用初始状态')
  } finally {
    root.unmount()
    window.journalBridge = previous
  }
}

window.__updatesSettingsTest = run()

import { createRoot } from 'react-dom/client'
import type { AppUpdateState } from '@/lib/appUpdate'
import type { JournalBridge } from '@/types/journalBridge'
import { waitFor } from '@/test/browserTiming'
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
  window.journalBridge = {
    isElectron: true,
    getUpdateState: async () => downloaded,
    onUpdateState: () => () => {},
    createVerifiedBackup: async () => { calls.push('单独备份'); return { status: 'verified' } },
    installUpdate: async () => { calls.push('安装'); return true },
  } as unknown as JournalBridge
  try {
    root.render(<UpdatesSettingsPanel />)
    await waitFor(() => container.querySelector('button')?.textContent?.includes('备份并重启更新'), '已下载更新缺少安装按钮')
    container.querySelector('button')!.click()
    await waitFor(() => calls.includes('安装'), '安装请求没有进入主进程')
    if (calls.join() !== '安装') throw new Error('设置页在关闭协调器之前单独创建了备份')
  } finally {
    root.unmount()
    window.journalBridge = previous
  }
}

window.__updatesSettingsTest = run()

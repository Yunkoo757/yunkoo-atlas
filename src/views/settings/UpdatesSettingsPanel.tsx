import { useEffect, useMemo, useState } from 'react'
import { Download, RotateCcw, Shield } from '@/icons/appIcons'
import { LoadingIndicator } from '@/icons/LoadingIndicator'
import { ProgressIndicator } from '@/icons/ProgressIndicator'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { getJournalBridge, isElectron } from '@/storage/runtime'
import type { AppUpdateState } from '@/lib/appUpdate'
import { toast } from '@/lib/toast'
import { flushPersistNow } from '@/storage/persist'
import './UpdatesSettingsPanel.css'

const FALLBACK_STATE: AppUpdateState = {
  phase: 'unsupported',
  currentVersion: '—',
  availableVersion: null,
  progress: null,
  message: '应用内更新仅在正式安装的桌面版中可用。',
}

function statusLabel(state: AppUpdateState): string {
  switch (state.phase) {
    case 'idle': return '尚未检查更新'
    case 'checking': return '正在检查更新…'
    case 'available': return `发现新版本 ${state.availableVersion ?? ''}`.trim()
    case 'downloading': return `正在下载 ${state.progress ?? 0}%`
    case 'downloaded': return `版本 ${state.availableVersion ?? ''} 已准备就绪`.trim()
    case 'up-to-date': return '当前已是最新版本'
    case 'unsupported': return state.message ?? '当前版本不支持应用内更新'
    case 'error': return state.message ?? '更新检查失败'
  }
}

export function UpdatesSettingsPanel() {
  const electron = isElectron()
  const [state, setState] = useState<AppUpdateState>(FALLBACK_STATE)

  useEffect(() => {
    if (!electron) return
    const bridge = getJournalBridge()!
    let active = true
    void bridge.getUpdateState().then((nextState) => {
      if (active) setState(nextState)
    })
    const unsubscribe = bridge.onUpdateState((nextState) => setState(nextState))
    return () => {
      active = false
      unsubscribe()
    }
  }, [electron])

  const busy = state.phase === 'checking' || state.phase === 'downloading'
  const statusTone = useMemo(() => {
    if (state.phase === 'error') return ' is-warn'
    if (state.phase === 'available' || state.phase === 'downloaded') return ' is-accent'
    if (state.phase === 'up-to-date') return ' is-ok'
    return ''
  }, [state.phase])

  const installUpdate = async () => {
    if (!electron) return
    await flushPersistNow()
    const backup = await getJournalBridge()!.createBackup()
    if (!backup) {
      toast('无法创建更新前备份，已取消安装')
      return
    }
    const verification = await getJournalBridge()!.verifyBackup(backup)
    if (verification.status !== 'verified') {
      toast(verification.error ?? '更新前备份验证失败，已取消安装')
      return
    }
    // 安装会走关闭保存回执（正在安全保存 / 已安全保存），不再弹 toast，避免底部双条重叠
    await getJournalBridge()!.installUpdate()
  }

  return (
    <div className="settings-page settings-page--form update-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">软件更新</h1>
      </div>

      <section className="update-section" aria-labelledby="update-version-title">
        <div className="update-section-head">
          <div>
            <h2 id="update-version-title">当前版本</h2>
            <p>Trader Atlas {state.currentVersion}</p>
          </div>
          <span className={'update-status' + statusTone}>{statusLabel(state)}</span>
        </div>

        {state.phase === 'downloading' && (
          <div className="update-progress-row">
            <ProgressIndicator
              progress={(state.progress ?? 0) / 100}
              size={ICON_SM}
              aria-hidden
            />
            <div className="update-progress" aria-label={`下载进度 ${state.progress ?? 0}%`}>
              <span style={{ transform: `scaleX(${(state.progress ?? 0) / 100})` }} />
            </div>
          </div>
        )}

        <div className="update-actions">
          {state.phase === 'available' ? (
            <button
              className="dio-btn dio-btn-primary"
              onClick={() => void getJournalBridge()?.downloadUpdate()}
            >
              <Download size={ICON_SM} />
              下载更新
            </button>
          ) : state.phase === 'downloading' ? (
            <button className="dio-btn dio-btn-primary" disabled aria-busy="true">
              <LoadingIndicator size={ICON_SM} aria-hidden />
              下载中… {state.progress != null ? `${state.progress}%` : ''}
            </button>
          ) : state.phase === 'downloaded' ? (
            <button className="dio-btn dio-btn-primary" onClick={() => void installUpdate()}>
              <RotateCcw size={ICON_SM} />
              备份并重启更新
            </button>
          ) : (
            <button
              className="dio-btn"
              disabled={!electron || busy}
              onClick={() => void getJournalBridge()?.checkForUpdates()}
            >
              {state.phase === 'checking' ? (
                <LoadingIndicator size={ICON_SM} aria-hidden />
              ) : (
                <RotateCcw size={ICON_SM} />
              )}
              {state.phase === 'checking' ? '检查中…' : '检查更新'}
            </button>
          )}
        </div>
      </section>

      <div className="update-security-note">
        <Shield size={ICON_MD} />
        <span>自动检查每 6 小时执行一次；无需配置 GitHub 令牌，不会在开发版或 Windows 便携版中下载更新。</span>
      </div>
    </div>
  )
}

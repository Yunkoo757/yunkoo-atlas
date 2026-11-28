import { useEffect, useState } from 'react'
import { Download, RotateCcw } from '@/icons/appIcons'
import { InlineStatus, type InlineStatusTone } from '@/components/ui/InlineStatus'
import { LoadingIndicator } from '@/icons/LoadingIndicator'
import { ICON_SM } from '@/icons/iconSize'
import { getJournalBridge, isElectron } from '@/storage/runtime'
import type { AppUpdateState } from '@/lib/appUpdate'
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
    case 'idle': return '等待自动检查'
    case 'checking': return '正在检查更新…'
    case 'available': return `发现新版本 ${state.availableVersion ?? ''}`.trim()
    case 'downloading': return `正在下载 ${state.progress ?? 0}%`
    case 'downloaded': return `版本 ${state.availableVersion ?? ''} 已准备就绪`.trim()
    case 'up-to-date': return '当前已是最新版本'
    case 'unsupported': return state.message ?? '当前版本不支持应用内更新'
    case 'error': return state.message ?? '更新检查失败'
  }
}

const UPDATE_STATUS_TONES: Partial<Record<AppUpdateState['phase'], InlineStatusTone>> = {
  available: 'info',
  downloaded: 'success',
  'up-to-date': 'success',
  error: 'warning',
}

export function UpdatesSettingsPanel() {
  const electron = isElectron()
  const [state, setState] = useState<AppUpdateState>(FALLBACK_STATE)

  useEffect(() => {
    if (!electron) return
    const bridge = getJournalBridge()!
    let acceptInitialState = true
    const unsubscribe = bridge.onUpdateState(nextState => {
      acceptInitialState = false
      setState(nextState)
    })
    void bridge.getUpdateState().then(nextState => {
      if (acceptInitialState) setState(nextState)
    })
    return () => {
      acceptInitialState = false
      unsubscribe()
    }
  }, [electron])

  const busy = state.phase === 'checking' || state.phase === 'downloading'

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
          {UPDATE_STATUS_TONES[state.phase]
            ? <InlineStatus tone={UPDATE_STATUS_TONES[state.phase]} compact title={statusLabel(state)} />
            : <p role="status">{statusLabel(state)}</p>}
        </div>

        {state.phase === 'downloading' && (
          <div className="update-progress-row">
            <div className="update-progress" role="progressbar" aria-label="下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress ?? 0}>
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
          ) : state.phase === 'downloading' ? null : state.phase === 'downloaded' ? (
            <button className="dio-btn dio-btn-primary" onClick={() => void getJournalBridge()?.installUpdate()}>
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

    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Download, LockKeyhole, RotateCcw, Shield } from '@/icons/appIcons'
import { LinearGridLoaderIcon, LinearGridProgressIcon } from '@/icons/linear'
import { ICON_SM } from '@/icons/iconSize'
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
    case 'credential-required': return '需要配置私有仓库访问令牌'
    case 'unsupported': return state.message ?? '当前版本不支持应用内更新'
    case 'error': return state.message ?? '更新检查失败'
  }
}

export function UpdatesSettingsPanel() {
  const electron = isElectron()
  const [state, setState] = useState<AppUpdateState>(FALLBACK_STATE)
  const [hasCredential, setHasCredential] = useState(false)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!electron) return
    const bridge = getJournalBridge()!
    let active = true
    void Promise.all([bridge.getUpdateState(), bridge.hasUpdateCredential()]).then(
      ([nextState, credential]) => {
        if (!active) return
        setState(nextState)
        setHasCredential(credential)
      },
    )
    const unsubscribe = bridge.onUpdateState((nextState) => setState(nextState))
    return () => {
      active = false
      unsubscribe()
    }
  }, [electron])

  const busy = state.phase === 'checking' || state.phase === 'downloading'
  const statusTone = useMemo(() => {
    if (state.phase === 'error' || state.phase === 'credential-required') return ' is-warn'
    if (state.phase === 'available' || state.phase === 'downloaded') return ' is-accent'
    if (state.phase === 'up-to-date') return ' is-ok'
    return ''
  }, [state.phase])

  const saveCredential = async () => {
    if (!electron || !token.trim()) return
    setSaving(true)
    try {
      await getJournalBridge()!.saveUpdateCredential(token)
      setToken('')
      setHasCredential(true)
      toast('更新令牌已安全保存')
      await getJournalBridge()!.checkForUpdates()
    } catch (error) {
      toast(error instanceof Error ? error.message : '令牌保存失败')
    } finally {
      setSaving(false)
    }
  }

  const clearCredential = async () => {
    if (!electron) return
    await getJournalBridge()!.clearUpdateCredential()
    setHasCredential(false)
    setToken('')
    toast('更新令牌已移除')
  }

  const installUpdate = async () => {
    if (!electron) return
    await flushPersistNow()
    const backup = await getJournalBridge()!.createBackup()
    if (!backup) {
      toast('无法创建更新前备份，已取消安装')
      return
    }
    toast('备份已创建，正在重启安装更新…')
    await getJournalBridge()!.installUpdate()
  }

  return (
    <div className="settings-page update-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">软件更新</h1>
        <p className="settings-page-desc">
          从私有 GitHub Release 获取正式版本。下载由你确认，安装前自动备份交易库。
        </p>
      </div>

      <section className="update-section" aria-labelledby="update-version-title">
        <div className="update-section-head">
          <div>
            <h2 id="update-version-title">当前版本</h2>
            <p>Yunkoo Atlas {state.currentVersion}</p>
          </div>
          <span className={'update-status' + statusTone}>{statusLabel(state)}</span>
        </div>

        {state.phase === 'downloading' && (
          <div className="update-progress-row">
            <LinearGridProgressIcon
              progress={(state.progress ?? 0) / 100}
              size={ICON_SM}
              aria-hidden
            />
            <div className="update-progress" aria-label={`下载进度 ${state.progress ?? 0}%`}>
              <span style={{ width: `${state.progress ?? 0}%` }} />
            </div>
          </div>
        )}

        <div className="update-actions">
          {state.phase === 'available' ? (
            <button className="dio-btn dio-btn-primary" onClick={() => void getJournalBridge()?.downloadUpdate()}>
              <Download size={14} />
              下载更新
            </button>
          ) : state.phase === 'downloaded' ? (
            <button className="dio-btn dio-btn-primary" onClick={() => void installUpdate()}>
              <RotateCcw size={14} />
              备份并重启更新
            </button>
          ) : (
            <button
              className="dio-btn"
              disabled={!electron || busy || !hasCredential}
              onClick={() => void getJournalBridge()?.checkForUpdates()}
            >
              {state.phase === 'checking' ? (
                <LinearGridLoaderIcon variant="scope" size={ICON_SM} aria-hidden />
              ) : (
                <RotateCcw size={14} />
              )}
              {state.phase === 'checking' ? '检查中…' : '检查更新'}
            </button>
          )}
        </div>
      </section>

      <section className="update-section" aria-labelledby="update-access-title">
        <div className="update-section-head">
          <div>
            <h2 id="update-access-title">私有仓库访问</h2>
            <p>令牌仅保存在这台电脑，并由系统安全存储加密。</p>
          </div>
          <span className={'update-credential-state' + (hasCredential ? ' is-ready' : '')}>
            <LockKeyhole size={13} />
            {hasCredential ? '已配置' : '未配置'}
          </span>
        </div>

        <div className="update-token-row">
          <input
            type="password"
            value={token}
            disabled={!electron}
            placeholder="粘贴 Fine-grained GitHub Token"
            aria-label="GitHub 更新令牌"
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
          />
          <button
            className="dio-btn dio-btn-primary"
            disabled={!electron || saving || !token.trim()}
            onClick={() => void saveCredential()}
          >
            {saving ? '保存中…' : '安全保存'}
          </button>
          {hasCredential && (
            <button className="dio-btn" onClick={() => void clearCredential()}>
              移除
            </button>
          )}
        </div>

        <p className="update-help">
          使用只授权 <code>Yunkoo757/yunkoo-atlas</code>、权限为
          <code> Contents: Read-only</code> 的 Fine-grained Token。不要使用账号密码或写入权限令牌。
        </p>
      </section>

      <div className="update-security-note">
        <Shield size={15} />
        <span>自动检查每 6 小时执行一次；不会在开发版或 Windows 便携版中下载更新。</span>
      </div>
    </div>
  )
}

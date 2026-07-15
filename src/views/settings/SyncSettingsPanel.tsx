import { useEffect, useState } from 'react'
import { CheckCircle, Cloud, Copy, LockKeyhole, RotateCcw, Trash2 } from '@/icons/appIcons'
import type { CloudSyncState, CloudSyncSetupMode } from '@/sync/cloudSync'
import { runCloudSyncWithLocalMerge, requestCloudSyncNow } from '@/sync/runtime'
import { getJournalBridge, isElectron } from '@/storage/runtime'
import { toast } from '@/lib/toast'
import './SyncSettingsPanel.css'

const DEFAULT_SYNC_URL = 'https://atlas-sync.129-226-147-141.sslip.io'

function statusText(state: CloudSyncState | null): string {
  if (!state) return '正在读取…'
  if (!state.hasToken) return '尚未配置'
  switch (state.phase) {
    case 'disabled': return '已配置 · 尚未启用'
    case 'syncing': return '正在同步…'
    case 'offline': return `离线 · ${state.pendingCount} 项待上传`
    case 'error': return '需要处理'
    case 'idle': return state.pendingCount > 0 ? `${state.pendingCount} 项待上传` : '已同步'
  }
}

function formatLastSync(value: string | null): string {
  if (!value) return '尚未完成同步'
  return `最近同步 ${new Date(value).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })}`
}

export function SyncSettingsPanel() {
  const electron = isElectron()
  const [state, setState] = useState<CloudSyncState | null>(null)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_SYNC_URL)
  const [libraryId, setLibraryId] = useState('')
  const [token, setToken] = useState('')
  const [working, setWorking] = useState<string | null>(null)

  useEffect(() => {
    if (!electron) return
    const bridge = getJournalBridge()
    if (!bridge) return
    let active = true
    void Promise.all([bridge.getCloudSyncState(), bridge.getManifest()]).then(([next, manifest]) => {
      if (!active) return
      setState(next)
      setBaseUrl(next.baseUrl || DEFAULT_SYNC_URL)
      setLibraryId(next.libraryId || manifest.libraryId)
    }).catch((error) => toast(error instanceof Error ? error.message : '读取云同步配置失败'))
    const unsubscribe = bridge.onCloudSyncState((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [electron])

  const save = async () => {
    const bridge = getJournalBridge()
    if (!bridge) return
    setWorking('save')
    try {
      const next = await bridge.saveCloudSyncConfig({
        baseUrl,
        libraryId,
        ...(token.trim() ? { token: token.trim() } : {}),
      })
      setState(next)
      setToken('')
      toast('云同步连接信息已安全保存')
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败')
    } finally {
      setWorking(null)
    }
  }

  const setup = async (mode: CloudSyncSetupMode) => {
    const bridge = getJournalBridge()
    if (!bridge) return
    if (
      mode === 'replace'
      && !window.confirm(
        '确定以这台设备的当前资料库重建云端？\n\n云端旧版本与旧附件将被清空，其他设备需要重新连接。此操作适用于恢复备份后确认以本机为准。',
      )
    ) return
    setWorking(mode)
    try {
      const execution = await runCloudSyncWithLocalMerge(() => bridge.setupCloudSync(mode))
      setState(execution.state)
      toast(
        mode === 'create'
          ? '已创建云端资料库并完成首次同步'
          : mode === 'replace'
            ? '已以本机资料库重建云端并恢复自动同步'
            : '已连接云端资料库',
      )
    } catch (error) {
      toast(error instanceof Error ? error.message : '云同步初始化失败')
    } finally {
      setWorking(null)
    }
  }

  const syncNow = async () => {
    setWorking('sync')
    try {
      const execution = await requestCloudSyncNow()
      setState(execution.state)
      toast(execution.state.phase === 'idle' ? '同步完成' : execution.state.message ?? '同步未完成')
    } catch (error) {
      toast(error instanceof Error ? error.message : '同步失败')
    } finally {
      setWorking(null)
    }
  }

  const pause = async () => {
    const bridge = getJournalBridge()
    if (!bridge) return
    setWorking('pause')
    try {
      const next = await bridge.saveCloudSyncConfig({ baseUrl, libraryId })
      setState(next)
      toast('自动同步已暂停，本地数据不受影响')
    } catch (error) {
      toast(error instanceof Error ? error.message : '暂停失败')
    } finally {
      setWorking(null)
    }
  }

  const clear = async () => {
    const bridge = getJournalBridge()
    if (!bridge || !window.confirm('清除此设备上的云同步连接信息？本地交易库和云端数据都不会删除。')) return
    setWorking('clear')
    try {
      setState(await bridge.clearCloudSyncConfig())
      setToken('')
      toast('此设备的云同步连接信息已清除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '清除云同步连接失败')
    } finally {
      setWorking(null)
    }
  }

  if (!electron) {
    return (
      <div className="settings-page sync-settings">
        <div className="settings-page-head">
          <h1 className="settings-page-title">云同步</h1>
          <p className="settings-page-desc">云同步仅在 Windows 与 macOS 桌面版中可用。</p>
        </div>
      </div>
    )
  }

  const busy = working !== null
  return (
    <div className="settings-page sync-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">云同步</h1>
        <p className="settings-page-desc">本地优先保存；启动、联网与系统唤醒后同步交易、设置和原图附件。</p>
      </div>

      <section className="sync-section">
        <div className="sync-section-head">
          <div>
            <h2>当前状态</h2>
            <p>{formatLastSync(state?.lastSyncAt ?? null)}</p>
          </div>
          <span className={`sync-status is-${state?.phase ?? 'disabled'}`}>
            {state?.phase === 'syncing' ? <RotateCcw size={13} /> : <Cloud size={13} />}
            {statusText(state)}
          </span>
        </div>
        {state?.message && <p className="sync-message" role="status">{state.message}</p>}
        {state && state.assetCount > 0 && (
          <p className={`sync-message ${state.missingAssetCount > 0 ? 'is-warn' : ''}`}>
            原图附件 {state.assetCount - state.missingAssetCount}/{state.assetCount} 已保存在本机，断网可查看。
          </p>
        )}
        {state && state.conflictCount > 0 && (
          <p className="sync-message is-warn">{state.conflictCount} 个并发修改已保留，未静默覆盖本机内容。</p>
        )}
        <div className="sync-actions">
          <button className="dio-btn dio-btn-primary" onClick={() => void syncNow()} disabled={!state?.enabled || busy}>
            <RotateCcw size={14} />
            {working === 'sync' ? '同步中…' : '立即同步'}
          </button>
          {state?.enabled && (
            <button className="dio-btn" onClick={() => void pause()} disabled={busy}>暂停自动同步</button>
          )}
        </div>
      </section>

      <section className="sync-section">
        <div className="sync-section-head">
          <div>
            <h2>连接信息</h2>
            <p>令牌只加密保存在当前电脑，不进入交易库或备份。</p>
          </div>
          <span className={`sync-status ${state?.hasToken ? 'is-idle' : 'is-disabled'}`}>
            <LockKeyhole size={13} />
            {state?.hasToken ? '已安全保存' : '未保存令牌'}
          </span>
        </div>
        <label className="sync-field">
          <span>服务器地址</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} />
        </label>
        <label className="sync-field">
          <span>云端资料库 ID</span>
          <div className="sync-field-inline">
            <input value={libraryId} onChange={(event) => setLibraryId(event.target.value)} spellCheck={false} />
            <button
              className="dio-btn"
              type="button"
              onClick={() => void navigator.clipboard.writeText(libraryId)
                .then(() => toast('资料库 ID 已复制'))
                .catch(() => toast('复制失败，请手动复制资料库 ID'))}
              disabled={!libraryId}
            >
              <Copy size={13} />复制
            </button>
          </div>
        </label>
        <label className="sync-field">
          <span>同步令牌</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={state?.hasToken ? '已保存；留空可继续使用' : '粘贴服务器同步令牌'}
            autoComplete="off"
          />
        </label>
        <div className="sync-actions">
          <button className="dio-btn dio-btn-primary" onClick={() => void save()} disabled={busy || !baseUrl.trim() || !libraryId.trim()}>
            <CheckCircle size={14} />
            {working === 'save' ? '保存中…' : '保存连接信息'}
          </button>
          {state?.hasToken && (
            <button className="dio-btn dio-btn-warn" onClick={() => void clear()} disabled={busy}>
              <Trash2 size={13} />清除此设备
            </button>
          )}
        </div>
      </section>

      {state?.hasToken && !state.enabled && (
        <section className="sync-section sync-onboarding">
          <div className="sync-choice">
            <div>
              <strong>这是保存主数据的第一台设备</strong>
              <span>创建云端资料库，并上传当前本地交易、设置与原图附件。</span>
            </div>
            <button className="dio-btn dio-btn-primary" onClick={() => void setup('create')} disabled={busy}>
              {working === 'create' ? '正在创建…' : '创建并首次同步'}
            </button>
          </div>
          <div className="sync-choice">
            <div>
              <strong>这是新增的 Windows 或 macOS 设备</strong>
              <span>输入第一台设备的资料库 ID，拉取完整数据与原图供离线使用，不上传空库。</span>
            </div>
            <button className="dio-btn" onClick={() => void setup('connect')} disabled={busy}>
              {working === 'connect' ? '正在连接…' : '连接已有资料库'}
            </button>
          </div>
          <div className="sync-choice is-danger">
            <div>
              <strong>恢复备份后，以这台设备为准</strong>
              <span>开启新的同步历史并替换云端内容；其他设备之后需要重新连接。</span>
            </div>
            <button className="dio-btn dio-btn-warn" onClick={() => void setup('replace')} disabled={busy}>
              {working === 'replace' ? '正在重建…' : '以本机重建云端'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

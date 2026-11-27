import { ICON_HERO, ICON_LG, ICON_MD } from '@/icons/iconSize'
import { useRef, useState } from 'react'
import type { JournalBridge, LibrarySwitchMode } from '@/types/journalBridge'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import { notifyStorageRecoveryRequired } from '@/lib/storageRecovery'
import { FolderOpen, Plus, HardDrive } from '@/icons/appIcons'
import { Button } from '@/components/ui/Button'
import './WelcomeScreen.css'

interface Props {
  bridge: JournalBridge
  onReady: () => void
}

export function WelcomeScreen({ bridge, onReady }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pickedPath, setPickedPath] = useState('')

  const activating = useRef(false)

  const pickFolder = async () => {
    setError('')
    try {
      const p = await bridge.pickLibraryFolder()
      if (p) setPickedPath(p)
    } catch {
      setError('无法打开文件夹选择器')
    }
  }

  const activate = async (mode: LibrarySwitchMode) => {
    if (!pickedPath || activating.current) return
    activating.current = true
    setBusy(true)
    setError('')
    const fallback = mode === 'create' ? '创建库失败，请重试' : '无法打开所选库'
    try {
      const result = mode === 'create'
        ? await bridge.createNewLibrary(pickedPath)
        : await bridge.openExistingLibrary(pickedPath)
      if (result.ok) {
        onReady()
      } else if (result.requiresReload) {
        notifyStorageRecoveryRequired(userFacingErrorMessage(result.error, '资料库位置需要重新确认，请重新打开资料库'))
      } else {
        setError(userFacingErrorMessage(result.error, fallback))
      }
    } catch (error) {
      setError(userFacingErrorMessage(error, fallback))
    } finally {
      activating.current = false
      setBusy(false)
    }
  }

  return (
    <div className="welcome-overlay">
      <div className="welcome-card">
        <div className="welcome-icon">
          <HardDrive size={ICON_HERO} />
        </div>
        <h1 className="welcome-title">欢迎使用 Trader Atlas</h1>
        <p className="welcome-desc">
          你的交易数据完全存储在本地。请选择或创建一个库目录来开始。
        </p>

        <div className="welcome-path-row">
          <button
            className="welcome-path-btn"
            onClick={pickFolder}
            disabled={busy}
            type="button"
          >
            <FolderOpen size={ICON_MD} />
            <span>{pickedPath || '点击选择目录…'}</span>
          </button>
        </div>

        {pickedPath && (
          <div className="welcome-actions">
            <Button
              className="welcome-btn"
              variant="primary"
              size="lg"
              onClick={() => void activate('create')}
              disabled={busy}
              type="button"
            >
              <Plus size={ICON_LG} />
              <span>在此创建新资料库</span>
            </Button>
            <Button
              className="welcome-btn"
              variant="bordered"
              size="lg"
              onClick={() => void activate('open')}
              disabled={busy}
              type="button"
            >
              <FolderOpen size={ICON_LG} />
              <span>打开已有资料库</span>
            </Button>
          </div>
        )}

        {error && <p className="welcome-error" role="alert">{error}</p>}

        <p className="welcome-hint">
          资料库目录中会存储交易数据（journal.db）和附件文件。
          <br />
          建议选择本机磁盘中稳定的专用位置，并定期创建完整备份。
        </p>
      </div>
    </div>
  )
}

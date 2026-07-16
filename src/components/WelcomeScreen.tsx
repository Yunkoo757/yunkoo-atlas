import { useState } from 'react'
import { FolderOpen, Plus, HardDrive } from '@/icons/appIcons'
import './WelcomeScreen.css'

interface Props {
  onReady: () => void
}

export function WelcomeScreen({ onReady }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pickedPath, setPickedPath] = useState('')

  const bridge = (window as any).journalBridge

  const pickFolder = async () => {
    setError('')
    try {
      const p = await bridge.pickLibraryFolder()
      if (p) setPickedPath(p)
    } catch {
      setError('无法打开文件夹选择器')
    }
  }

  const createNew = async () => {
    if (!pickedPath) return
    setBusy(true)
    setError('')
    try {
      const result = await bridge.createNewLibrary(pickedPath)
      if (result.ok) {
        onReady()
      } else {
        setError('创建库失败，请重试')
      }
    } catch {
      setError('创建库时发生错误')
    } finally {
      setBusy(false)
    }
  }

  const openExisting = async () => {
    if (!pickedPath) return
    setBusy(true)
    setError('')
    try {
      const result = await bridge.openExistingLibrary(pickedPath)
      if (result.ok) {
        onReady()
      } else {
        setError(result.error ?? '无法打开所选库')
      }
    } catch {
      setError('打开库时发生错误')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome-overlay">
      <div className="welcome-card">
        <div className="welcome-icon">
          <HardDrive size={40} />
        </div>
        <h1 className="welcome-title">欢迎使用 Yunkoo Atlas</h1>
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
            <FolderOpen size={16} />
            <span>{pickedPath || '点击选择目录…'}</span>
          </button>
        </div>

        {pickedPath && (
          <div className="welcome-actions">
            <button
              className="welcome-btn welcome-btn-primary"
              onClick={createNew}
              disabled={busy}
              type="button"
            >
              <Plus size={18} />
              <span>在此创建新库</span>
            </button>
            <button
              className="welcome-btn welcome-btn-secondary"
              onClick={openExisting}
              disabled={busy}
              type="button"
            >
              <FolderOpen size={18} />
              <span>打开已有库</span>
            </button>
          </div>
        )}

        {error && <p className="welcome-error">{error}</p>}

        <p className="welcome-hint">
          库目录中会存储交易数据 (journal.db) 和附件文件。
          <br />
          建议选择本机磁盘中稳定的专用位置，并定期创建完整备份。
        </p>
      </div>
    </div>
  )
}

import { useState, useRef } from 'react'
import { useStore } from '@/store/useStore'
import { AVATAR_PRESETS, resizeAvatarImage } from '@/lib/avatars'
import { UserAvatar } from '@/components/UserAvatar'
import { Check, Upload, X } from '@/icons/appIcons'
import './ProfileSettingsPanel.css'

export function ProfileSettingsPanel() {
  const profile = useStore((s) => s.profile)
  const setAvatar = useStore((s) => s.setAvatar)
  const setCustomAvatar = useStore((s) => s.setCustomAvatar)
  const setDisplayName = useStore((s) => s.setDisplayName)
  const [nameDraft, setNameDraft] = useState(profile.displayName)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleNameSave = () => {
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === profile.displayName) {
      setNameDraft(profile.displayName)
      return
    }
    setDisplayName(trimmed)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return
    setUploading(true)
    try {
      const dataUrl = await resizeAvatarImage(file)
      setCustomAvatar(dataUrl)
    } catch {
      // 忽略
    } finally {
      setUploading(false)
    }
  }

  const hasCustom = profile.customAvatarDataUrl ? true : false

  return (
    <div className="settings-page profile-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">个人资料</h1>
        <p className="settings-page-desc">
          选择头像并设置显示名称，在侧栏与交易列表中展示。
        </p>
      </div>

      {/* 预览 */}
      <div className="profile-preview">
        <UserAvatar className="profile-preview-avatar" />
        <span className="profile-preview-name">{profile.displayName}</span>
      </div>

      {/* 自定义图片上传 */}
      <section className="profile-section">
        <h2 className="profile-section-title">自定义头像</h2>
        <p className="profile-section-hint">
          上传图片将自动裁剪为正方形并缩放到 128×128。
        </p>
        <div className="profile-upload-row">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="dio-btn"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={14} />
            <span>{uploading ? '处理中…' : '上传图片'}</span>
          </button>
          {hasCustom && (
            <button
              type="button"
              className="dio-btn dio-btn-warn"
              onClick={() => setCustomAvatar(null)}
            >
              <X size={14} />
              <span>移除自定义头像</span>
            </button>
          )}
        </div>
        {hasCustom && (
          <p className="profile-custom-hint">
            当前使用自定义图片。选择下方预置头像将替换自定义图片。
          </p>
        )}
      </section>

      {/* 预置头像选择 */}
      <section className="profile-section">
        <h2 className="profile-section-title">预置头像</h2>
        <div className="profile-avatar-grid">
          {AVATAR_PRESETS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={
                'profile-avatar-item' +
                (profile.avatarId === a.id ? ' is-selected' : '')
              }
              aria-label={a.label}
              onClick={() => setAvatar(profile.avatarId === a.id ? null : a.id)}
            >
              <span className="profile-avatar-emoji">{a.emoji}</span>
              <span className="profile-avatar-label">{a.label}</span>
            </button>
          ))}
        </div>
        {(profile.avatarId || hasCustom) && (
          <button
            type="button"
            className="profile-reset-avatar"
            onClick={() => {
              setAvatar(null)
              setCustomAvatar(null)
            }}
          >
            清除头像（使用首字母）
          </button>
        )}
      </section>

      {/* 名称 */}
      <section className="profile-section">
        <h2 className="profile-section-title">显示名称</h2>
        <div className="profile-name-row">
          <input
            type="text"
            className="profile-name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNameSave() }}
            placeholder="输入名称…"
            maxLength={24}
          />
          <button
            type="button"
            className="dio-btn dio-btn-primary"
            onClick={handleNameSave}
            disabled={!nameDraft.trim() || nameDraft.trim() === profile.displayName}
          >
            <Check size={14} />
            <span>{saved ? '已保存' : '保存'}</span>
          </button>
        </div>
      </section>
    </div>
  )
}

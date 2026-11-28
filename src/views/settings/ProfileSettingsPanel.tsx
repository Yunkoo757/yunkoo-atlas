import { isComposingKey } from '@/lib/keyboardComposition'
import { ICON_SM } from '@/icons/iconSize'
import { useEffect, useId, useRef, useState } from 'react'
import { useStore } from '@/store/useStore'
import { AVATAR_PRESETS, getAvatarPreset, resizeAvatarImage } from '@/lib/avatars'
import { PresetAvatarGraphic, UserAvatar } from '@/components/UserAvatar'
import { Check, Upload, X } from '@/icons/appIcons'
import { flushPersistNow } from '@/storage/persist'
import { InlineStatus } from '@/components/ui/InlineStatus'
import { Button } from '@/components/ui/Button'
import { LoadingIndicator } from '@/icons/LoadingIndicator'
import { withLibrarySession } from '../withLibrarySession'
import './ProfileSettingsPanel.css'

export const ProfileSettingsPanel = withLibrarySession<object>(ProfileSettingsForm)

function ProfileSettingsForm({ librarySession }: { librarySession: number }) {
  const profile = useStore((s) => s.profile)
  const setAvatar = useStore((s) => s.setAvatar)
  const uploadAvatar = useStore((s) => s.uploadAvatar)
  const uploading = useStore((s) => s.pendingAvatarUpload !== null)
  const setDisplayName = useStore((s) => s.setDisplayName)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const nameValue = nameDraft ?? profile.displayName
  const [nameError, setNameError] = useState('')
  const nameErrorId = useId()
  const [saved, setSaved] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!saved) return
    const timeout = window.setTimeout(() => setSaved(false), 1500)
    return () => window.clearTimeout(timeout)
  }, [saved])

  const handleNameSave = async () => {
    const trimmed = nameValue.trim()
    if (savingName || !trimmed || trimmed === profile.displayName) return
    const previousName = profile.displayName
    setNameError('')
    setSavingName(true)
    setDisplayName(trimmed)
    try {
      await flushPersistNow()
      setNameDraft(null)
      setSaved(true)
    } catch {
      const current = useStore.getState()
      if (current.librarySession !== librarySession) return
      if (current.profile.displayName === trimmed) {
        setDisplayName(previousName)
        try {
          await flushPersistNow()
        } catch {
          setNameError('无法写入资料库。请检查资料库是否可写，再重试。')
          return
        }
      }
      setNameError('名称保存失败，请重试。')
    } finally {
      setSavingName(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAvatarError('')
    if (!file.type.startsWith('image/')) {
      setAvatarError('请选择图片文件。')
      return
    }
    try {
      await uploadAvatar(() => resizeAvatarImage(file))
    } catch {
      setAvatarError('无法读取这张图片，请重新选择。')
    }
  }

  const hasCustom = profile.customAvatarDataUrl ? true : false
  const activePresetId = getAvatarPreset(profile.avatarId).id

  return (
    <div className="settings-page settings-page--form profile-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">个人资料</h1>
      </div>

      {/* 预览 */}
      <div className="profile-preview">
        <UserAvatar className="profile-preview-avatar" />
        <span className="profile-preview-name">{profile.displayName}</span>
      </div>

      {/* 名称 */}
      <section className="profile-section">
        <h2 className="profile-section-title">显示名称</h2>
        <div className="profile-name-row">
          <input
            type="text"
            className="profile-name-input"
            aria-label="显示名称"
            value={nameValue}
            readOnly={savingName}
            aria-describedby={nameError ? nameErrorId : undefined}
            onChange={(e) => {
              setSaved(false)
              setNameError('')
              setNameDraft(e.target.value === profile.displayName ? null : e.target.value)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingKey(e.nativeEvent)) void handleNameSave() }}
            placeholder="输入名称…"
            maxLength={24}
          />
          <Button
            variant="primary"
            busy={savingName}
            onClick={() => void handleNameSave()}
            disabled={!nameValue.trim() || nameValue.trim() === profile.displayName}
          >
            {savingName && <LoadingIndicator size={ICON_SM} />}
            {saved && <Check size={ICON_SM} aria-hidden />}
            {savingName ? '保存中…' : saved ? '已保存' : nameError ? '重试' : '保存'}
          </Button>
        </div>
        {nameError && (
          <InlineStatus compact className="profile-name-error" tone="error" title={<span id={nameErrorId}>{nameError}</span>} />
        )}
      </section>

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
            <Upload size={ICON_SM} />
            <span>{uploading ? '处理中…' : '上传图片'}</span>
          </button>
          {hasCustom && (
            <button
              type="button"
              className="dio-btn"
              onClick={() => setAvatar(null)}
            >
              <X size={ICON_SM} />
              <span>移除自定义头像</span>
            </button>
          )}
        </div>
        {avatarError && <InlineStatus compact tone="error" title={avatarError} />}
        {hasCustom && (
          <p className="profile-custom-hint">
            当前使用自定义图片。选择下方预置头像将替换自定义图片。
          </p>
        )}
      </section>

      {/* 预置头像选择 */}
      <section className="profile-section">
        <h2 className="profile-section-title">头像风格</h2>
        <div className="profile-avatar-grid">
          {AVATAR_PRESETS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={
                'profile-avatar-item' +
                (!hasCustom && activePresetId === a.id ? ' is-selected' : '')
              }
              aria-label={a.label}
              aria-pressed={!hasCustom && activePresetId === a.id}
              onClick={() => setAvatar(a.id)}
            >
              <span className="profile-avatar-art"><PresetAvatarGraphic presetId={a.id} /></span>
              <span className="profile-avatar-label">{a.label}</span>
            </button>
          ))}
        </div>
        {(profile.avatarId || hasCustom) && (
          <button
            type="button"
            className="profile-reset-avatar"
            onClick={() => setAvatar(null)}
          >
            恢复默认头像
          </button>
        )}
      </section>

    </div>
  )
}

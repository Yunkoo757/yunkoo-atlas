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

  const hasCustom = Boolean(profile.customAvatarDataUrl)
  const activePreset = getAvatarPreset(profile.avatarId)
  const activePresetId = activePreset.id
  const canResetAvatar = Boolean(profile.avatarId || hasCustom)

  return (
    <div className="settings-page settings-page--form profile-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">资料</h1>
      </div>

      <section className="settings-group" aria-label="基本信息">
        <div className="settings-card">
          <div className="settings-row profile-identity-row">
            <div className="profile-identity-main">
              <UserAvatar className="profile-preview-avatar" />
              <div className="profile-identity-copy">
                <span className="profile-preview-name">{profile.displayName}</span>
                <span className="settings-row-desc">
                  {hasCustom ? '自定义图片' : activePreset.label}
                </span>
              </div>
            </div>
            <div className="settings-row-control">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="profile-file-input"
                onChange={handleFileChange}
              />
              <Button
                variant="bordered"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                <Upload size={ICON_SM} />
                <span>{uploading ? '处理中…' : '上传图片'}</span>
              </Button>
              {hasCustom ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAvatar(null)}
                >
                  <X size={ICON_SM} />
                  <span>移除</span>
                </Button>
              ) : canResetAvatar ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAvatar(null)}
                >
                  恢复默认
                </Button>
              ) : null}
            </div>
          </div>

          {avatarError && (
            <div className="profile-inline-feedback">
              <InlineStatus compact tone="error" title={avatarError} />
            </div>
          )}

          <div className="settings-row profile-name-setting">
            <div className="settings-row-copy">
              <span className="settings-row-title">显示名称</span>
            </div>
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
                size="sm"
                busy={savingName}
                onClick={() => void handleNameSave()}
                disabled={!nameValue.trim() || nameValue.trim() === profile.displayName}
              >
                {savingName && <LoadingIndicator size={ICON_SM} />}
                {saved && <Check size={ICON_SM} aria-hidden />}
                {savingName ? '保存中…' : saved ? '已保存' : nameError ? '重试' : '保存'}
              </Button>
            </div>
          </div>

          {nameError && (
            <div className="profile-inline-feedback">
              <InlineStatus compact tone="error" title={<span id={nameErrorId}>{nameError}</span>} />
            </div>
          )}
        </div>
      </section>

      <section className="settings-group" aria-labelledby="profile-presets-title">
        <div className="settings-group-head">
          <h2 id="profile-presets-title" className="settings-section-title">预置头像</h2>
        </div>
        <div className="settings-card settings-card-padded">
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
        </div>
      </section>
    </div>
  )
}

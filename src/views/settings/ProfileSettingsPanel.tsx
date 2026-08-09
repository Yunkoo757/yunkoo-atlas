import { useState, useRef } from 'react'
import { useStore } from '@/store/useStore'
import { AVATAR_PRESETS, getAvatarPreset, resizeAvatarImage } from '@/lib/avatars'
import { PresetAvatarGraphic, UserAvatar } from '@/components/UserAvatar'
import { Check, Upload, X } from '@/icons/appIcons'
import { normalizeCashCurrency } from '@/data/trades'
import './ProfileSettingsPanel.css'

export function ProfileSettingsPanel() {
  const profile = useStore((s) => s.profile)
  const setAvatar = useStore((s) => s.setAvatar)
  const setCustomAvatar = useStore((s) => s.setCustomAvatar)
  const setDisplayName = useStore((s) => s.setDisplayName)
  const trades = useStore((s) => s.trades)
  const setLegacyCashCurrencyAssumption = useStore((s) => s.setLegacyCashCurrencyAssumption)
  const [nameDraft, setNameDraft] = useState(profile.displayName)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [currencyConfirmationChecked, setCurrencyConfirmationChecked] = useState(false)
  const [currencySaving, setCurrencySaving] = useState(false)
  const [currencyMessage, setCurrencyMessage] = useState('')
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
  const activePresetId = getAvatarPreset(profile.avatarId).id
  const cashTrades = trades.filter((trade) => typeof trade.pnl === 'number' && Number.isFinite(trade.pnl))
  const legacyMissingCurrencyCount = cashTrades.filter((trade) => (
    !Object.prototype.hasOwnProperty.call(trade, 'cashCurrency')
  )).length
  const explicitUnknownCurrencyCount = cashTrades.filter((trade) => (
    Object.prototype.hasOwnProperty.call(trade, 'cashCurrency') &&
    normalizeCashCurrency(trade.cashCurrency) === null
  )).length
  const effectiveUnknownCurrencyCount = explicitUnknownCurrencyCount + (
    profile.legacyCashCurrencyAssumption ? 0 : legacyMissingCurrencyCount
  )

  const updateCurrencyAssumption = async (confirmed: boolean) => {
    setCurrencySaving(true)
    setCurrencyMessage('')
    try {
      await setLegacyCashCurrencyAssumption(confirmed)
      setCurrencyConfirmationChecked(false)
      setCurrencyMessage(confirmed ? '已持久化确认并重算 USD 统计。' : '已撤销假设，旧记录重新排除在 USD 总计外。')
    } catch (error) {
      setCurrencyMessage(error instanceof Error ? `保存失败：${error.message}` : '保存失败，请稍后重试。')
    } finally {
      setCurrencySaving(false)
    }
  }

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

      <section className="profile-section" aria-labelledby="legacy-currency-title">
        <h2 id="legacy-currency-title" className="profile-section-title">现金币种数据健康</h2>
        <p className="profile-section-hint">
          当前有 {effectiveUnknownCurrencyCount} 笔现金结果因币种未知不进入 USD 总计；其中 {legacyMissingCurrencyCount} 笔为旧记录缺少币种字段，{explicitUnknownCurrencyCount} 笔为来源明确标记未知。
        </p>
        {profile.legacyCashCurrencyAssumption ? (
          <div>
            <p className="profile-section-hint">
              已于 {profile.legacyCashCurrencyAssumption.confirmedAt} 确认：缺少币种字段的旧记录按 USD 解释。显式 CNY 或币种未知记录不会被覆盖。
            </p>
            <button
              type="button"
              className="dio-btn dio-btn-warn"
              disabled={currencySaving}
              onClick={() => void updateCurrencyAssumption(false)}
            >
              撤销历史 USD 假设
            </button>
          </div>
        ) : (
          <div>
            <label className="profile-section-hint">
              <input
                type="checkbox"
                checked={currencyConfirmationChecked}
                onChange={(event) => setCurrencyConfirmationChecked(event.target.checked)}
              />
              仅当全部历史现金值确为 USD 时使用。我确认所有缺少币种字段的旧记录均为 USD。
            </label>
            <button
              type="button"
              className="dio-btn"
              disabled={currencySaving || !currencyConfirmationChecked || legacyMissingCurrencyCount === 0}
              onClick={() => void updateCurrencyAssumption(true)}
            >
              {currencySaving ? '持久化中…' : '确认旧记录为 USD'}
            </button>
          </div>
        )}
        {currencyMessage ? <p role="status" className="profile-section-hint">{currencyMessage}</p> : null}
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
        <h2 className="profile-section-title">头像风格</h2>
        <p className="profile-section-hint">一组为深色界面定制的矢量头像，在侧栏与列表中保持清晰。</p>
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
            onClick={() => {
              setAvatar(null)
              setCustomAvatar(null)
            }}
          >
            恢复默认头像
          </button>
        )}
      </section>

    </div>
  )
}

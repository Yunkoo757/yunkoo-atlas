import { useStore } from '@/store/useStore'
import { getAvatarPreset, resolveAvatar } from '@/lib/avatars'

/** 统一用户头像：自定义图片 > 矢量预置头像。 */
export function UserAvatar({ className }: { className?: string }) {
  const profile = useStore((s) => s.profile)
  const avatar = resolveAvatar(profile)

  if (avatar.type === 'image') {
    return (
      <img
        className={className}
        src={avatar.src}
        alt={profile.displayName}
        style={{ objectFit: 'cover', borderRadius: '50%' }}
      />
    )
  }

  return (
    <span className={className}>
      <PresetAvatarGraphic presetId={avatar.presetId} />
    </span>
  )
}

export function PresetAvatarGraphic({ presetId }: { presetId: string }) {
  const preset = getAvatarPreset(presetId)

  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={preset.label}>
      <rect width="64" height="64" rx="32" fill={preset.background} />
      {preset.variant === 'halo' && (
        <circle cx="32" cy="27" r="20" fill="none" stroke={preset.accent} strokeWidth="2" opacity=".7" />
      )}
      {preset.variant === 'orbit' && (
        <path d="M8 39C19 17 43 11 57 24" fill="none" stroke={preset.accent} strokeWidth="3" strokeLinecap="round" opacity=".75" />
      )}
      {preset.variant === 'split' && (
        <path d="M0 0h29L16 64H0z" fill={preset.accent} opacity=".35" />
      )}
      {preset.variant === 'frame' && (
        <path d="M13 23V13h10M41 13h10v10" fill="none" stroke={preset.accent} strokeWidth="2.5" strokeLinecap="round" />
      )}
      <circle cx="32" cy="25" r="10" fill={preset.surface} />
      <path d="M13 58c1.8-13 9.2-20 19-20s17.2 7 19 20z" fill={preset.surface} />
      <path d="M22 43c2.8 3.3 6.1 5 10 5s7.2-1.7 10-5l3.2 4.2C41.7 53 37.3 56 32 56s-9.7-3-13.2-8.8z" fill={preset.accent} opacity=".92" />
      <circle cx="50" cy="14" r="2.5" fill={preset.accent} />
    </svg>
  )
}

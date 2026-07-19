import { useStore } from '@/store/useStore'
import { getAvatarPreset, resolveAvatar } from '@/lib/avatars'

type UserAvatarProps = {
  className?: string
  shape?: 'circle' | 'rounded-square'
}

/** 统一用户头像：自定义图片 > 矢量预置头像。 */
export function UserAvatar({ className, shape = 'circle' }: UserAvatarProps) {
  const profile = useStore((s) => s.profile)
  const avatar = resolveAvatar(profile)

  if (avatar.type === 'image') {
    return (
      <img
        className={className}
        src={avatar.src}
        alt={profile.displayName}
        style={{ objectFit: 'cover', borderRadius: shape === 'rounded-square' ? '8px' : '50%' }}
      />
    )
  }

  return (
    <span className={className}>
      <PresetAvatarGraphic presetId={avatar.presetId} shape={shape} />
    </span>
  )
}

export function PresetAvatarGraphic({
  presetId,
  shape = 'circle',
}: {
  presetId: string
  shape?: UserAvatarProps['shape']
}) {
  const preset = getAvatarPreset(presetId)

  return (
    <svg viewBox="0 0 80 80" role="img" aria-label={preset.label}>
      <rect width="80" height="80" rx={shape === 'rounded-square' ? 32 : 40} fill={preset.background} />
      <circle cx="40" cy="42" r="25" fill={preset.face} stroke={preset.ink} strokeWidth="3" />
      <path
        d="M23 34c9-17 30-17 37-1"
        fill="none"
        stroke={preset.accent}
        strokeWidth="8"
        strokeLinecap="round"
      />
      <circle cx="31" cy="42" r="3" fill={preset.ink} />
      <circle cx="49" cy="42" r="3" fill={preset.ink} />
      <path
        d="M31 54c7 5 14 5 20 0"
        fill="none"
        stroke={preset.ink}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

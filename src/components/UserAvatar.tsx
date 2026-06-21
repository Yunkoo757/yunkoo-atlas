import { useStore } from '@/store/useStore'
import { resolveAvatar } from '@/lib/avatars'

/** 统一用户头像：自定义图片 > 预置 emoji > 首字母 */
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
      {avatar.type === 'emoji' ? avatar.emoji : avatar.letter}
    </span>
  )
}

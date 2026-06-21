import type { UserProfile } from '@/storage/types'

export interface AvatarPreset {
  id: string
  emoji: string
  label: string
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'trader', emoji: '📈', label: '交易员' },
  { id: 'bull', emoji: '🐂', label: '牛市' },
  { id: 'bear', emoji: '🐻', label: '熊市' },
  { id: 'wolf', emoji: '🐺', label: '华尔街' },
  { id: 'eagle', emoji: '🦅', label: '鹰眼' },
  { id: 'owl', emoji: '🦉', label: '智慧' },
  { id: 'diamond', emoji: '💎', label: '钻石手' },
  { id: 'rocket', emoji: '🚀', label: '火箭' },
  { id: 'fire', emoji: '🔥', label: '火热' },
  { id: 'star2', emoji: '⭐', label: '明星' },
  { id: 'crown', emoji: '👑', label: '王者' },
  { id: 'shield', emoji: '🛡️', label: '防守' },
  { id: 'target', emoji: '🎯', label: '精准' },
  { id: 'brain', emoji: '🧠', label: '策略' },
  { id: 'coin', emoji: '🪙', label: '财富' },
  { id: 'chart', emoji: '📊', label: '图表' },
]

export function getAvatarEmoji(avatarId: string | null | undefined): string | undefined {
  if (!avatarId) return undefined
  return AVATAR_PRESETS.find((a) => a.id === avatarId)?.emoji
}

/**
 * 统一头像解析：自定义图片 > 预置 emoji > 首字母
 */
export function resolveAvatar(
  profile: UserProfile | undefined | null,
): { type: 'image'; src: string } | { type: 'emoji'; emoji: string } | { type: 'initial'; letter: string } {
  if (profile?.customAvatarDataUrl) {
    return { type: 'image', src: profile.customAvatarDataUrl }
  }
  const emoji = getAvatarEmoji(profile?.avatarId)
  if (emoji) {
    return { type: 'emoji', emoji }
  }
  const letter = (profile?.displayName || 'Y').charAt(0).toUpperCase()
  return { type: 'initial', letter }
}

/** 缩放并居中裁剪为正方形，压缩到 128×128 JPEG data URL */
export function resizeAvatarImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const size = Math.min(128, img.width, img.height)
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas 不可用')); return }

        const side = Math.min(img.width, img.height)
        const sx = img.width > img.height ? (img.width - img.height) / 2 : 0
        const sy = img.height > img.width ? (img.height - img.width) / 2 : 0
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

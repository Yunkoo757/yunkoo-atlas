import type { UserProfile } from '@/storage/types'

export interface AvatarPreset {
  id: string
  label: string
  background: string
  surface: string
  accent: string
  variant: 'halo' | 'orbit' | 'split' | 'frame'
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'obsidian', label: '曜石', background: '#17191f', surface: '#d8c9ad', accent: '#c7a74b', variant: 'halo' },
  { id: 'cobalt', label: '钴蓝', background: '#18233a', surface: '#d5dceb', accent: '#6686d9', variant: 'orbit' },
  { id: 'forest', label: '松林', background: '#172823', surface: '#d6ded5', accent: '#6d9d84', variant: 'frame' },
  { id: 'clay', label: '陶土', background: '#35221f', surface: '#ead5c7', accent: '#c2765d', variant: 'split' },
  { id: 'sand', label: '砂岩', background: '#302d27', surface: '#e4dccb', accent: '#ae9161', variant: 'frame' },
  { id: 'violet', label: '鸢尾', background: '#29233a', surface: '#ddd6e8', accent: '#8e75bd', variant: 'orbit' },
  { id: 'glacier', label: '冰川', background: '#1b2c33', surface: '#d7e4e6', accent: '#6ba7b1', variant: 'split' },
  { id: 'eclipse', label: '日蚀', background: '#2b2023', surface: '#e2d5cf', accent: '#d08255', variant: 'halo' },
]

const LEGACY_PRESET_MAP: Record<string, string> = {
  trader: 'cobalt', bull: 'clay', bear: 'obsidian', wolf: 'glacier',
  eagle: 'sand', owl: 'forest', diamond: 'glacier', rocket: 'cobalt',
  fire: 'eclipse', star2: 'sand', crown: 'violet', shield: 'forest',
  target: 'clay', brain: 'violet', coin: 'sand', chart: 'cobalt',
}

export function getAvatarPreset(avatarId: string | null | undefined): AvatarPreset {
  const resolvedId = avatarId ? (LEGACY_PRESET_MAP[avatarId] ?? avatarId) : 'obsidian'
  return AVATAR_PRESETS.find((preset) => preset.id === resolvedId) ?? AVATAR_PRESETS[0]!
}

/**
 * 统一头像解析：自定义图片 > 矢量预置头像。
 */
export function resolveAvatar(
  profile: UserProfile | undefined | null,
): { type: 'image'; src: string } | { type: 'preset'; presetId: string } {
  if (profile?.customAvatarDataUrl) {
    return { type: 'image', src: profile.customAvatarDataUrl }
  }
  return { type: 'preset', presetId: getAvatarPreset(profile?.avatarId).id }
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

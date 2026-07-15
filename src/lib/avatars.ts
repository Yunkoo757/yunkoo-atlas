import type { UserProfile } from '@/storage/types'

export interface AvatarPreset {
  id: string
  label: string
  background: string
  face: string
  accent: string
  ink: string
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'lime-blue', label: '黄绿蓝', background: '#d8f06b', face: '#f7d86d', accent: '#2768d8', ink: '#122033' },
  { id: 'mint', label: '薄荷绿', background: '#baf7d0', face: '#f2d58c', accent: '#1fbf83', ink: '#14231d' },
  { id: 'sky', label: '天空蓝', background: '#bfe7ff', face: '#ffd488', accent: '#2f80ed', ink: '#10213a' },
  { id: 'rose', label: '玫瑰粉', background: '#ffd3df', face: '#f5d174', accent: '#e65b8a', ink: '#2a1621' },
  { id: 'mono', label: '黑金', background: '#20242d', face: '#f2c66d', accent: '#32c481', ink: '#0c1117' },
  { id: 'violet', label: '夜紫', background: '#ddd5ff', face: '#f5cf79', accent: '#7657e8', ink: '#211936' },
  { id: 'coral', label: '珊瑚橙', background: '#ffd7bd', face: '#f5cf78', accent: '#ed694c', ink: '#2b1812' },
  { id: 'teal', label: '深海青', background: '#bdece7', face: '#f1d17f', accent: '#149f9d', ink: '#102a2b' },
]

const LEGACY_PRESET_MAP: Record<string, string> = {
  obsidian: 'lime-blue', cobalt: 'sky', forest: 'mint', clay: 'coral',
  sand: 'mono', glacier: 'teal', eclipse: 'rose',
  trader: 'sky', bull: 'coral', bear: 'mono', wolf: 'teal',
  eagle: 'lime-blue', owl: 'mint', diamond: 'teal', rocket: 'sky',
  fire: 'coral', star2: 'lime-blue', crown: 'violet', shield: 'mint',
  target: 'rose', brain: 'violet', coin: 'mono', chart: 'sky',
}

export function getAvatarPreset(avatarId: string | null | undefined): AvatarPreset {
  const resolvedId = avatarId ? (LEGACY_PRESET_MAP[avatarId] ?? avatarId) : 'lime-blue'
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

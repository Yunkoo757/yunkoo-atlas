import profileJson from '@/config/default-profile.json'
import type { Strategy, StrategyIconId } from '@/data/strategies'
import type { ShortcutBinding } from '@/shortcuts/types'
import type { UserProfile } from '@/storage/types'

type DefaultGroupMode = 'date' | 'strategy' | 'none'
type DefaultSort = 'date' | 'pnl' | 'conviction'

interface DefaultProfile {
  schema: 'yunkoo-atlas-default-profile'
  schemaVersion: 1
  app: 'Yunkoo Atlas'
  profile: {
    name: string
    version: string
    description: string
  }
  user: {
    displayName: string
  }
  settings: {
    display: {
      hideClosed: boolean
      showEmptyGroups: boolean
      groupMode: DefaultGroupMode
      sortBy: DefaultSort
    }
  }
  tags: {
    general: string[]
    mistakes: string[]
  }
  strategies: Array<{
    id: string
    name: string
    icon: StrategyIconId
    color: string
  }>
  shortcuts: Record<string, ShortcutBinding | null>
}

export const DEFAULT_PROFILE = profileJson as DefaultProfile
export const DEFAULT_PROFILE_DISPLAY = DEFAULT_PROFILE.settings.display
export const DEFAULT_USER_DISPLAY_NAME = DEFAULT_PROFILE.user.displayName

export function createDefaultUserProfile(): UserProfile {
  return {
    avatarId: null,
    displayName: DEFAULT_USER_DISPLAY_NAME,
    customAvatarDataUrl: null,
  }
}

export function createDefaultStrategies(): Strategy[] {
  return DEFAULT_PROFILE.strategies.map((strategy) => ({ ...strategy }))
}

export function createDefaultTagPresets(): string[] {
  return [...DEFAULT_PROFILE.tags.general]
}

export function createDefaultMistakeTagPresets(): string[] {
  return [...DEFAULT_PROFILE.tags.mistakes]
}

export function getDefaultShortcutBinding(id: string): ShortcutBinding {
  const binding = DEFAULT_PROFILE.shortcuts[id]
  if (!binding) throw new Error(`默认配置缺少快捷键动作：${id}`)
  return Array.isArray(binding)
    ? binding.map((chord) => ({ ...chord }))
    : { ...binding }
}

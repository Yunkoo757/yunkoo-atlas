import {
  DataNavIcon,
  DisplayNavIcon,
  ProfileNavIcon,
  RiskNavIcon,
  ReviewTemplatesNavIcon,
  ShortcutsNavIcon,
  StrategiesNavIcon,
  SymbolsNavIcon,
  TagsNavIcon,
  UpdatesNavIcon,
} from '@/icons/SettingsIcons'

export const SETTINGS_SECTIONS = {
  profile: { to: '/settings/profile', label: '资料', icon: ProfileNavIcon },
  shortcuts: { to: '/settings/shortcuts', label: '快捷键', icon: ShortcutsNavIcon },
  strategies: { to: '/settings/strategies', label: '策略', icon: StrategiesNavIcon },
  risk: { to: '/settings/risk', label: '风险管理', icon: RiskNavIcon },
  tags: { to: '/settings/tags', label: '标签', icon: TagsNavIcon },
  symbols: { to: '/settings/symbols', label: '品种', icon: SymbolsNavIcon },
  reviewTemplates: { to: '/settings/review-templates', label: '复盘起稿', icon: ReviewTemplatesNavIcon },
  display: { to: '/settings/display', label: '显示', icon: DisplayNavIcon },
  data: { to: '/settings/data', label: '数据', icon: DataNavIcon },
  updates: { to: '/settings/updates', label: '更新', icon: UpdatesNavIcon },
} as const

export const SETTINGS_NAV = Object.values(SETTINGS_SECTIONS)

export const SETTINGS_NAV_GROUPS = [
  {
    id: 'preferences',
    label: '偏好',
    items: [SETTINGS_SECTIONS.profile, SETTINGS_SECTIONS.display, SETTINGS_SECTIONS.shortcuts],
  },
  {
    id: 'trading',
    label: '交易',
    items: [
      SETTINGS_SECTIONS.strategies,
      SETTINGS_SECTIONS.risk,
      SETTINGS_SECTIONS.tags,
      SETTINGS_SECTIONS.symbols,
      SETTINGS_SECTIONS.reviewTemplates,
    ],
  },
  {
    id: 'system',
    label: '系统',
    items: [SETTINGS_SECTIONS.data, SETTINGS_SECTIONS.updates],
  },
] as const

export function findSettingsSection(pathname: string) {
  return SETTINGS_NAV.find(({ to }) => pathname === to || pathname.startsWith(to + '/'))
}
